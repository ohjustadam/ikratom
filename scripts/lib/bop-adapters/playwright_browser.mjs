/**
 * Headless-browser adapter for BoP sources that do TLS fingerprinting
 * (JA3-level WAF filtering). Real Chromium has the right TLS handshake
 * + cookie handling + JS execution to satisfy these sites; Node fetch
 * doesn't.
 *
 * Currently used by: KS, NH, MA, AR.
 *
 * IMPORTANT: this adapter ONLY runs in environments that can launch
 * Chromium — local dev + GitHub Actions. The Vercel cron explicitly
 * excludes this adapter via the engine's excludeAdapters option, so
 * the heavy Playwright deps + binaries never have to live on the
 * serverless function.
 *
 * Launching a browser is expensive (~1.5s). The orchestrator reuses
 * a single browser instance across all sources by calling
 * preWarmBrowser() once and closeBrowser() at the end.
 */

import { extractFindingsFromHtml } from "./_html_extract.mjs";

let _browser = null;
let _playwright = null;

async function getPlaywright() {
  if (_playwright) return _playwright;
  // Dynamic import so the .mjs engine doesn't fail to load when
  // playwright isn't installed (e.g. on Vercel).
  _playwright = await import("playwright-chromium");
  return _playwright;
}

export async function preWarmBrowser() {
  if (_browser) return _browser;
  const { chromium } = await getPlaywright();
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch { /* best-effort */ }
    _browser = null;
  }
}

// Same SSRF defense as generic_html — a headless browser following a
// link to an internal service is even worse than a Node fetch because
// it executes any JS that lands.
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
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
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
    throw new Error(`Refusing to navigate unsafe URL: ${url}`);
  }

  const browser = await preWarmBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1920, height: 1080 },
    // Real-browser-ish behavior so WAFs don't flag us as a bot:
    // accept cookies, follow JS redirects, respect referrer.
    javaScriptEnabled: true,
    bypassCSP: true,
    extraHTTPHeaders: {
      Referer: "https://www.google.com/",
    },
  });

  let html;
  try {
    const page = await context.newPage();
    // domcontentloaded is enough — we don't need to wait for every
    // analytics tracker. 25s timeout matches the engine budget.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    // Give SPA frameworks a beat to populate the DOM. Many .gov sites
    // are server-rendered, but the ones with Cloudflare challenges
    // also have a brief JS gate to pass.
    await page.waitForTimeout(1500);
    html = await page.content();
  } catch (e) {
    await context.close();
    throw new Error(`playwright fetch failed: ${e?.message ?? e}`);
  }
  await context.close();

  return extractFindingsFromHtml(html, url);
}
