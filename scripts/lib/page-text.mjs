/**
 * page-text.mjs — deterministic fetch + tag-strip for one web page.
 *
 * Shared by officials-extract.mjs (Tier-3 roster pages) and ban-verify.mjs
 * (local-ordinance verification). Always returns the full tag-stripped page
 * text, NOT Readability: rosters and ordinance text live in tables/sidebars
 * that article extraction discards (verified on cityoflewistown.com —
 * Readability kept the meeting schedule and dropped every commissioner).
 * Noise is fine; the extractors work from raw text.
 *
 * Returns null on ANY failure (non-OK status, PDF, network error, timeout)
 * so callers just skip to their next candidate URL.
 */

export async function fetchPageText(url, { timeoutMs = 15_000, maxChars = 24_000 } = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("pdf")) return null; // no PDF extraction in this path
    const html = (await res.text()).slice(0, 600_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c >= 32 && c < 65536 ? String.fromCharCode(c) : " "; })
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}
