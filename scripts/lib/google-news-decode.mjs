/**
 * google-news-decode.mjs — resolve a news.google.com RSS/article redirect URL
 * to the real publisher URL, KEYLESS and browser-free.
 *
 * Why this exists: Google News RSS hands out opaque redirect URLs
 * (news.google.com/rss/articles/CBMi…). The original resolver
 * (resolve-news-urls.mjs) drove a headless Chromium to follow Google's JS
 * redirect — ~7s/item, a 150MB binary, and increasingly walled by Google's
 * consent / anti-bot interstitials, so the backlog never cleared. Google's own
 * news player swaps the opaque id for the publisher URL through a PUBLIC
 * batchexecute RPC ("Fbv4je" / garturlreq); we call it directly: one GET to read
 * the per-article signature + timestamp, one POST to exchange them for the URL.
 * Verified 10/10 across KWCH/Fox/MSN/AOL/Manila Times/etc. Keyless → runs in the
 * ghost-server GHA job with no Chromium.
 *
 * @returns {Promise<{ok:true,url:string} | {ok:false,reason:string,permanent:boolean}>}
 *   permanent:true  → don't retry (malformed id, 404 article, RPC returned nothing)
 *   permanent:false → transient (timeout / 429 / 5xx / missing markers); retry later
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BATCH_ENDPOINT =
  "https://news.google.com/_/DotsSplashUi/data/batchexecute";

export function isGoogleNewsUrl(url) {
  return typeof url === "string" && /(^|\/\/)news\.google\.com\//.test(url);
}

/**
 * Pull the publisher URL out of a batchexecute response. The body is an XSSI-
 * guarded ()]}' prefix) JSON array whose Fbv4je row carries the result as a
 * JSON-STRING-inside-JSON: ["garturlres","https://…"]. So the URL is double-
 * escaped (\\u003d, \\u0026); a naive regex truncates it at the first backslash.
 * Walk the parsed tree and double-JSON.parse the payload string, which unescapes
 * the URL natively. Returns the clean URL or null.
 */
function parseBatchUrl(txt) {
  let s = txt;
  if (s.startsWith(")]}'")) { const nl = s.indexOf("\n"); s = nl >= 0 ? s.slice(nl + 1) : s.slice(4); }
  let outer;
  try { outer = JSON.parse(s); } catch { return null; }
  const stack = [outer];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === "string") {
      if (!node.includes("garturlres")) continue;
      try {
        const arr = JSON.parse(node);
        const found = (Array.isArray(arr) ? arr : []).find(
          (x) => typeof x === "string" && /^https?:\/\//.test(x) && !x.includes("google.com") && !x.includes("gstatic.com"),
        );
        if (found) return found;
      } catch { /* not the payload string; keep walking */ }
    } else if (Array.isArray(node)) {
      for (const c of node) stack.push(c);
    }
  }
  return null;
}

/** The fixed garturlreq envelope Google's player sends; only id/ts/sig vary. */
function buildPayload(id, ts, sig) {
  const inner = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
      "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, Number(ts), sig,
  ];
  return "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", JSON.stringify(inner), null, "generic"]]]));
}

export async function decodeGoogleNewsUrl(url, opts = {}) {
  const ua = opts.ua ?? DEFAULT_UA;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const m = typeof url === "string" && url.match(/articles\/([^?/]+)/);
  if (!m) return { ok: false, reason: "not-an-articles-url", permanent: true };
  const id = m[1];

  // Step 1 — fetch the article shell to read its signature + timestamp.
  let html;
  try {
    const r = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { "User-Agent": ua, Accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      // 404/410 → article pulled, give up; 429/5xx → transient.
      return { ok: false, reason: `page-${r.status}`, permanent: r.status === 404 || r.status === 410 };
    }
    html = await r.text();
  } catch (e) {
    return { ok: false, reason: `page-fetch:${e.name ?? e.message}`, permanent: false };
  }

  const sg = html.match(/data-n-a-sg="([^"]+)"/);
  const ts = html.match(/data-n-a-ts="([^"]+)"/);
  if (!sg || !ts) return { ok: false, reason: "no-sig-ts", permanent: false };

  // Step 2 — exchange (id, ts, sig) for the publisher URL.
  let txt;
  try {
    const br = await fetch(BATCH_ENDPOINT, {
      method: "POST",
      headers: { "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: buildPayload(id, ts[1], sg[1]),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!br.ok) return { ok: false, reason: `batch-${br.status}`, permanent: false };
    txt = await br.text();
  } catch (e) {
    return { ok: false, reason: `batch-fetch:${e.name ?? e.message}`, permanent: false };
  }

  const publisherUrl = parseBatchUrl(txt);
  if (!publisherUrl) return { ok: false, reason: "no-url-in-response", permanent: true };
  return { ok: true, url: publisherUrl };
}
