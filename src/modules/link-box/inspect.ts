import "server-only";

import { safeFetch } from "@/lib/url-safety";
import { firstUrl, linkVariants } from "@/lib/shared-link";
import { pageMeta, type PageMeta } from "@/lib/link-box";
import { decodeGoogleNewsUrl, isGoogleNewsUrl } from "../../../scripts/lib/google-news-decode.mjs";
import { browserUA } from "../../../scripts/lib/browser-ua.mjs";

/**
 * Follow a shared link once, so the duplicate check sees every address the
 * same story may be stored under:
 *   1. the link as given (minus tracking parameters, see linkVariants);
 *   2. a news.google.com link decoded to the publisher (keyless, #news decode);
 *   3. where its redirects end (a bit.ly or AMP link);
 *   4. the page's own <link rel="canonical">, which on a syndicated copy
 *      (MSN, Yahoo, AOL) often names the original publisher.
 * SSRF-safe (safeFetch re-checks every redirect hop), 5 s per step, at most
 * 300 KB read. Never throws: a page that won't load still gets steps 1-2.
 */
export type Inspected = {
  /** The cleaned link the member gave. */
  url: string;
  /** Every stored-URL spelling to look up (capped for the query string). */
  spellings: string[];
  /** The best address to store: canonical, else where it landed, else the decoded one. */
  publisherUrl: string;
  meta: PageMeta;
};

const STEP_MS = 5_000;
const MAX_BYTES = 300_000;
const EMPTY: PageMeta = { title: null, description: null, canonical: null, siteName: null };

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const take = c.subarray(0, all.length - at);
    all.set(take, at);
    at += take.length;
    if (at >= all.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

async function fetchPage(url: string): Promise<{ finalUrl: string; meta: PageMeta }> {
  try {
    const r = await safeFetch(url, {
      signal: AbortSignal.timeout(STEP_MS),
      headers: { "User-Agent": browserUA("iKratom-LinkBox/1.0 (+https://www.ikratom.org)"), Accept: "text/html,application/xhtml+xml" },
    });
    if (!r.ok) return { finalUrl: url, meta: EMPTY };
    const res = r.response;
    const finalUrl = res.url || url;
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) {
      res.body?.cancel().catch(() => {});
      return { finalUrl, meta: EMPTY };
    }
    return { finalUrl, meta: pageMeta(await readCapped(res), finalUrl) };
  } catch {
    return { finalUrl: url, meta: EMPTY };
  }
}

export async function inspectLink(raw: string): Promise<Inspected | null> {
  const url = firstUrl(String(raw ?? "").slice(0, 2000));
  if (!url || !linkVariants(url).length) return null;

  let target = url;
  if (isGoogleNewsUrl(url)) {
    const d = await decodeGoogleNewsUrl(url, { timeoutMs: STEP_MS }).catch(() => null);
    if (d && d.ok) target = d.url;
  }
  const { finalUrl, meta } = await fetchPage(target);

  const spellings = new Set<string>();
  for (const u of [url, target, finalUrl, meta.canonical]) for (const v of linkVariants(u)) spellings.add(v);
  return {
    url,
    spellings: [...spellings].slice(0, 30),
    // A page may name any canonical it likes; store it only when it stays on the same site.
    publisherUrl: (meta.canonical && sameSite(meta.canonical, finalUrl) ? meta.canonical : finalUrl).slice(0, 1000),
    meta,
  };
}

function sameSite(a: string, b: string): boolean {
  try {
    const h = (u: string) => new URL(u).hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
    return h(a) === h(b);
  } catch {
    return false;
  }
}
