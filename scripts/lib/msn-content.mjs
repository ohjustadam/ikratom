/**
 * msn-content.mjs — keyless MSN article body via the public content API.
 *
 * MSN article pages defeat both plain fetch (JS shell) and headless Chromium
 * (automation detection — the article never renders). But the underlying
 * content is served as JSON from a public, keyless endpoint:
 *
 *   https://assets.msn.com/content/view/v2/Detail/<locale>/<id>
 *
 * where <id> is the trailing token of the ar-/vi- slug in the page URL.
 * Returns the article body wrapped in minimal HTML so the existing
 * extractArticleContent() parser works unchanged, or null for non-MSN URLs /
 * videos without a body / any failure.
 */

const MSN_ID_RE = /\bmsn\.com\/[^\s"']*\/(?:ar|vi)-([A-Za-z0-9]+)/i;
const MSN_LOCALE_RE = /\bmsn\.com\/([a-z]{2}-[a-z]{2})\//i;

export function msnArticleId(url) {
  const m = String(url ?? "").match(MSN_ID_RE);
  return m ? m[1] : null;
}

export async function fetchMsnArticleHtml(url, { timeoutMs = 15_000 } = {}) {
  const id = msnArticleId(url);
  if (!id) return null;
  const locale = (String(url).match(MSN_LOCALE_RE) ?? [])[1]?.toLowerCase() ?? "en-us";
  try {
    const res = await fetch(`https://assets.msn.com/content/view/v2/Detail/${locale}/${id}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; iKratom-reader/1.0; +https://www.ikratom.org)" },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const body = typeof d?.body === "string" ? d.body.trim() : "";
    if (!body) return null;
    const title = typeof d?.title === "string" ? `<h1>${d.title}</h1>` : "";
    return `<html><body><article>${title}${body}</article></body></html>`;
  } catch {
    return null;
  }
}
