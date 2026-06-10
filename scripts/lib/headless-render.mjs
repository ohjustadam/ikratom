/**
 * headless-render.mjs — Playwright-chromium fallback renderer (PR-B).
 *
 * Some pages defeat plain fetch: JS-rendered rosters (San Jose, Greensboro,
 * Cedar Rapids), MSN-class article shells, and TLS-fingerprinting WAFs.
 * Real Chromium executes the JS and presents the right handshake — no
 * Firecrawl, no key, ever.
 *
 * playwright-chromium is already a repo dependency (resolve-news-urls, the
 * BoP browser adapter), so the browser ships everywhere npm install runs.
 * Everything degrades to null: missing package, missing binary, launch
 * failure, navigation timeout — callers keep their plain-fetch result.
 *
 * Browser lifecycle: lazy singleton, auto-closed after 30s idle (unref'd
 * timer) so batch scripts can't leak a chromium past process exit; callers
 * may also closeHeadless() explicitly. Set HEADLESS_RENDER=0 to disable.
 */

let _playwright = null;
let _browser = null;
let _idleTimer = null;
const IDLE_MS = 30_000;

// Same SSRF defense as the BoP browser adapter — a headless browser
// navigating to an internal service is worse than a Node fetch because it
// executes whatever JS it finds there.
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

function bumpIdle() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { closeHeadless(); }, IDLE_MS);
  _idleTimer.unref?.();
}

async function getBrowser() {
  if (_browser) return _browser;
  try {
    if (!_playwright) _playwright = await import("playwright-chromium");
    _browser = await _playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });
    return _browser;
  } catch {
    return null; // package or binary unavailable here — caller degrades
  }
}

export async function closeHeadless() {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (_browser) {
    const b = _browser;
    _browser = null;
    try { await b.close(); } catch { /* best-effort */ }
  }
}

/**
 * Render one page in headless Chromium.
 * @returns { html, text } (text = document.body.innerText) or null on any
 *          failure / when disabled via HEADLESS_RENDER=0.
 */
export async function renderPage(url, { timeoutMs = 25_000, settleMs = 1500 } = {}) {
  if (process.env.HEADLESS_RENDER === "0") return null;
  if (!isSafeForFetch(url)) return null;
  const browser = await getBrowser();
  if (!browser) return null;
  bumpIdle();
  let context;
  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1920, height: 1080 },
      javaScriptEnabled: true,
      bypassCSP: true,
      extraHTTPHeaders: { Referer: "https://www.google.com/" },
    });
    const page = await context.newPage();
    // Skip heavy resources — we want the DOM, not the pixels.
    await page.route("**/*", (route) =>
      ["image", "media", "font"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give SPA frameworks a beat to populate the DOM.
    await page.waitForTimeout(settleMs);
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    return { html: html ?? "", text: text ?? "" };
  } catch {
    return null;
  } finally {
    try { await context?.close(); } catch { /* best-effort */ }
    bumpIdle();
  }
}
