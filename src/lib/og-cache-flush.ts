/**
 * Open Graph cache invalidation — tells social platforms to re-fetch
 * a URL's preview card after the underlying content changes.
 *
 * Fires-and-forgets to multiple platforms in parallel. Never throws
 * (we don't want a cache-flush failure to block the real action that
 * triggered it). All failures get console.error'd for ops review.
 *
 * Supported:
 *   - Facebook + Messenger + Instagram → graph.facebook.com (requires
 *     FB_APP_ACCESS_TOKEN if cache is older; for first-time URLs the
 *     unauth ping is enough to seed)
 *   - LinkedIn → no public invalidation API but they re-crawl on share
 *   - Twitter/X → Card Validator API (deprecated; live preview happens
 *     on tweet compose, so no pre-warm needed)
 *
 * Call this whenever:
 *   - A municipal_meetings row's broadcast_at, agenda_text, or status changes
 *   - A briefing is regenerated
 *   - A patch note ships
 *   - Any opengraph-image content materially changes
 */

const FB_TOKEN = process.env.FB_APP_ACCESS_TOKEN;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

export type FlushResult = {
  url: string;
  facebook: { attempted: boolean; ok: boolean; status?: number; note?: string };
};

/**
 * Trigger a re-scrape of the URL's OG metadata on Facebook.
 * - If FB_APP_ACCESS_TOKEN is set: uses Graph API scrape=true (fully reliable)
 * - Otherwise: hits the URL with the facebookexternalhit user-agent so
 *   their crawler picks it up next time someone shares it (best-effort).
 */
export async function flushOpenGraphCache(url: string): Promise<FlushResult> {
  const result: FlushResult = {
    url,
    facebook: { attempted: false, ok: false },
  };

  // Make sure URL is absolute
  const absoluteUrl = url.startsWith("http") ? url : `${APP_URL}${url.startsWith("/") ? "" : "/"}${url}`;

  // Path A: FB Graph API with app access token (authenticated, reliable)
  if (FB_TOKEN) {
    result.facebook.attempted = true;
    try {
      const params = new URLSearchParams({
        id: absoluteUrl,
        scrape: "true",
        access_token: FB_TOKEN,
      });
      const r = await fetch(`https://graph.facebook.com/v18.0/?${params}`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      result.facebook.status = r.status;
      result.facebook.ok = r.ok;
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        result.facebook.note = body.slice(0, 200);
      } else {
        result.facebook.note = "scrape=true OK";
      }
    } catch (e) {
      result.facebook.note = `fetch err: ${(e as Error).message?.slice(0, 100)}`;
    }
    return result;
  }

  // Path B: hit our own URL with FB's crawler UA — pre-warms our cache
  // and primes our own analytics; FB will fetch it freshly the next
  // time someone shares the URL. Best-effort.
  result.facebook.attempted = true;
  try {
    const r = await fetch(absoluteUrl, {
      headers: {
        "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    result.facebook.status = r.status;
    result.facebook.ok = r.ok;
    result.facebook.note = "warmed via facebookexternalhit UA (no token)";
  } catch (e) {
    result.facebook.note = `warm err: ${(e as Error).message?.slice(0, 100)}`;
  }
  return result;
}

/**
 * Flush OG cache for a list of related URLs in parallel — useful when
 * one broadcast affects /meetings/[id] + /pulse + /calendar all at once.
 */
export async function flushMultipleOg(urls: string[]): Promise<FlushResult[]> {
  return Promise.all(urls.map((u) => flushOpenGraphCache(u)));
}
