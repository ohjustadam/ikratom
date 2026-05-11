/**
 * Generic HTML adapter — fetches the source URL with full Chrome-
 * equivalent headers and extracts findings via _html_extract.mjs.
 *
 * Used for ~95% of state BoP pages. The 4 sites that do TLS
 * fingerprinting (KS/NH/MA/AR) need playwright_browser.mjs instead.
 */

import { extractFindingsFromHtml } from "./_html_extract.mjs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Full Chrome-equivalent header set. Smoke-tested against 50+ state
// gov sites — these get past every WAF we tested except the 4 that
// also do TLS fingerprinting (KS/NH/MA/AR — JA3-level filtering
// which Node fetch can't replicate without a headless browser).
const HEADERS = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,image/apng,*/*;q=0.8," +
    "application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua":
    '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://www.google.com/",
};

// Defense-in-depth SSRF check. The admin UI already validates URLs
// at submission time, but if a malicious row landed in bop_sources
// via some other path (compromised DB, future migration bug, etc.),
// the scraper refuses to follow it.
function isSafeForFetch(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "80" && u.port !== "443") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "metadata.google.internal") return false;
    if (/\.(local|internal|lan|home|corp|intra)$/.test(h)) return false;
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [a, b] = v4.slice(1).map(Number);
      if (a === 10) return false;
      if (a === 127) return false;
      if (a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }
    if (h.startsWith("[") || h.includes(":")) {
      // IPv6 literal — block any loopback/unique-local/link-local
      const stripped = h.replace(/^\[|\]$/g, "");
      if (stripped === "::1" || stripped === "::" ) return false;
      if (stripped.startsWith("fc") || stripped.startsWith("fd")) return false;
      if (stripped.startsWith("fe80:")) return false;
      if (stripped.startsWith("::ffff:")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function scrape({ source }) {
  const url = source.agenda_url;
  if (!url) return [];
  if (!isSafeForFetch(url)) {
    throw new Error(`Refusing to fetch unsafe URL: ${url}`);
  }

  let html;
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|xhtml|application\/xml/i.test(contentType)) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }
    html = await res.text();
  } catch (e) {
    throw new Error(`fetch failed: ${e?.message ?? e}`);
  }

  return extractFindingsFromHtml(html, url);
}
