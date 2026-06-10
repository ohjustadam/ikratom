/**
 * page-text.mjs — fetch + tag-strip for one web page, with a headless-render
 * fallback for JS-built pages (PR-B).
 *
 * Shared by officials-extract.mjs (Tier-3 roster pages) and ban-verify.mjs
 * (local-ordinance verification). Always returns the full tag-stripped page
 * text, NOT Readability: rosters and ordinance text live in tables/sidebars
 * that article extraction discards (verified on cityoflewistown.com —
 * Readability kept the meeting schedule and dropped every commissioner).
 * Noise is fine; the extractors work from raw text.
 *
 * Fallback: when plain fetch fails or yields a thin JS shell (< 600 chars —
 * a real roster/ordinance page is never that small), the page is rendered in
 * headless Chromium (scripts/lib/headless-render.mjs) and we take
 * document.body.innerText. That unsticks San Jose / Greensboro / Cedar
 * Rapids–class rosters with no Firecrawl, no key. Render degrades to null
 * wherever Chromium isn't available, so cloud callers keep today's behavior.
 *
 * Returns null when nothing usable could be fetched — callers skip to their
 * next candidate URL.
 */

import { renderPage } from "./headless-render.mjs";

// Below this, a page is a JS shell ("enable JavaScript", nav crumbs), not
// content — worth the cost of a render attempt.
const THIN_TEXT_CHARS = 600;

function stripHtml(html, maxChars) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c >= 32 && c < 65536 ? String.fromCharCode(c) : " "; })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

async function plainFetchText(url, { timeoutMs, maxChars }) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("pdf")) return "PDF"; // sentinel: no text, don't render either
    const html = (await res.text()).slice(0, 600_000);
    return stripHtml(html, maxChars);
  } catch {
    return null;
  }
}

export async function fetchPageText(url, { timeoutMs = 15_000, maxChars = 24_000, render = true } = {}) {
  const plain = await plainFetchText(url, { timeoutMs, maxChars });
  if (plain === "PDF") return null; // no PDF extraction in this path
  if (plain && plain.length >= THIN_TEXT_CHARS) return plain;
  if (!render) return plain;
  // Thin or failed — likely a JS-rendered page. Try real Chromium.
  const r = await renderPage(url);
  if (!r) return plain;
  const text = r.text.replace(/\s+/g, " ").trim().slice(0, maxChars);
  // A WAF interstitial isn't content — junk text must not beat null.
  if (text.length < 1200 && /access denied|enable javascript|verify you are human|are you a robot|captcha|attention required/i.test(text)) {
    return plain;
  }
  return text.length > (plain?.length ?? 0) ? text : plain;
}
