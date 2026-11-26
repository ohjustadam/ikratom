/**
 * What an error report may carry to Sentry.
 *
 * Left alone, the SDK attaches the request's parsed cookies (the member's
 * sign-in session), the visitor's IP headers and the query string. None of that
 * is needed to fix a bug, and /privacy says it is removed. Every
 * sentry.*.config.ts sends its events through here
 * (tests/sentry-scrub.test.ts holds them to it).
 */
const KEEP_HEADERS = new Set(["accept", "content-length", "content-type", "host", "user-agent"]);

type Scrubbable = {
  request?: {
    url?: string;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  contexts?: Record<string, Record<string, unknown> | undefined>;
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  user?: { ip_address?: string | null };
};

/** A URL or path without its query string or fragment. */
const bare = (url: string) => url.split(/[?#]/)[0];

export function scrubEvent<T>(event: T): T {
  const e = event as Scrubbable;
  const req = e.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = bare(req.url);
    // An allow list, so a header the host adds tomorrow is not sent by default.
    if (req.headers) {
      req.headers = Object.fromEntries(
        Object.entries(req.headers).filter(([name]) => KEEP_HEADERS.has(name.toLowerCase())),
      );
    }
  }
  const nextjs = e.contexts?.nextjs;
  if (nextjs && typeof nextjs.request_path === "string") nextjs.request_path = bare(nextjs.request_path);
  // Breadcrumbs record earlier requests; database queries carry values in the query string.
  for (const { data } of e.breadcrumbs ?? []) {
    if (!data) continue;
    for (const key of ["url", "from", "to"]) {
      const value = data[key];
      if (typeof value === "string") data[key] = bare(value);
    }
    delete data["http.query"];
    delete data["http.fragment"];
  }
  if (e.user) delete e.user.ip_address;
  return event;
}
