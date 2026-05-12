#!/usr/bin/env node
/**
 * Phase 2 — Resolve Google News redirect URLs to publisher URLs
 * using Playwright (real Chromium can follow Google's client-side JS
 * redirect; HTTP fetch cannot).
 *
 * Reads news_items where resolved_at IS NULL and the URL is on
 * news.google.com, opens each in a headless browser, captures the
 * final page.url() after JS redirects settle, and stores it back
 * in news_items.resolved_url.
 *
 * Why this exists: the existing sync-news-rss.mjs resolveUrl() uses
 * `fetch(url, {redirect:"follow", method:"HEAD"})` which returns
 * news.google.com itself — Google encodes the publisher URL in the
 * CBM... path and uses JS to navigate. Real browser navigates fine.
 *
 * Runs in GitHub Actions nightly (Chromium pre-installed there).
 * Locally:
 *   npx playwright install chromium
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --limit 100
 *
 * Polite: 2s delay between resolves, 20s navigation timeout, single
 * concurrent worker. ~6-8s per resolve = ~100 items in 15 minutes.
 *
 * IMPORTANT: This script ONLY runs where Chromium is available
 * (local dev with playwright installed, or GitHub Actions). Do not
 * call from Vercel — the binary is ~150MB.
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "100");
const REFRESH = args.includes("--refresh");
const DRY_RUN = args.includes("--dry-run");
const TIMEOUT_MS = 20_000;
const POLITE_DELAY_MS = 2_000;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dynamic import — playwright-chromium isn't installed everywhere.
let chromium;
try {
  const pw = await import("playwright-chromium");
  chromium = pw.chromium;
} catch (e) {
  console.error("✗ playwright-chromium not installed.");
  console.error("  Install: npx playwright install chromium");
  console.error("  Or run this from .github/workflows/cron-daily.yml (Chromium pre-installed).");
  process.exit(1);
}

// ---------- main ----------
let q = sb.from("news_items")
  .select("id, url, title, state")
  .eq("active", true)
  // Only resolve Google News URLs — other publisher URLs are fine as-is.
  .ilike("url", "%news.google.com%")
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("resolved_at", null);

const { data: items, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!items || items.length === 0) {
  console.log("Nothing to resolve.");
  process.exit(0);
}

console.log(`Resolving ${items.length} Google News redirects${DRY_RUN ? " [DRY RUN]" : ""}…\n`);

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
  ],
});

let resolved = 0, sameAsInput = 0, errored = 0;
const t0 = Date.now();

try {
  for (const it of items) {
    const tag = `[${(it.state ?? "?").padEnd(3)}] ${(it.title ?? "").slice(0, 70)}`;
    process.stdout.write(`  ${tag} `);

    let context, page;
    let finalUrl = null;
    try {
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
        // Disable images + media to speed up navigation — we only need the URL.
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
      });

      // Pre-set the CONSENT cookie so we skip Google's "Before you
      // continue" consent screen. Without this, every navigation
      // bounces to consent.google.com and we never reach the publisher.
      // Pattern from googleapis docs + community Playwright recipes.
      await context.addCookies([
        {
          name: "CONSENT",
          value: "YES+cb.20240101-08-p1.en+FX+999",
          domain: ".google.com",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
          httpOnly: false,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "SOCS",
          value: "CAESHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmVuIAEaBgiAm-CtBg",
          domain: ".google.com",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
          httpOnly: false,
          secure: true,
          sameSite: "Lax",
        },
      ]);

      // Block heavy resource types — we just need the redirect to fire.
      await context.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (t === "image" || t === "media" || t === "font") return route.abort();
        return route.continue();
      });

      page = await context.newPage();
      // 'load' is too strict for some publishers (analytics scripts hang);
      // 'domcontentloaded' fires before the JS redirect is even queued.
      await page.goto(it.url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

      // Google News fires its redirect via a setTimeout AFTER DOM
      // ready — typically 1-3 seconds. Poll the page URL until it
      // leaves news.google.com, or we time out at REDIRECT_WAIT_MS.
      const REDIRECT_WAIT_MS = 8_000;
      const POLL_MS = 250;
      const redirectDeadline = Date.now() + REDIRECT_WAIT_MS;
      while (Date.now() < redirectDeadline) {
        const u = page.url();
        if (!/news\.google\.com|consent\.google\.com/.test(u)) break;
        await sleep(POLL_MS);
      }
      finalUrl = page.url();
    } catch (e) {
      // Soft errors — record verified_at so we don't retry every cron.
      errored++;
      if (!DRY_RUN) {
        await sb.from("news_items").update({
          resolved_at: new Date().toISOString(),
        }).eq("id", it.id);
      }
      console.log(`✗ ${e.message?.slice(0, 50)}`);
      try { await context?.close(); } catch { /* best-effort */ }
      await sleep(POLITE_DELAY_MS);
      continue;
    }

    try { await page.close(); } catch { /* */ }
    try { await context.close(); } catch { /* */ }

    // If the final URL is still on news.google.com, the redirect
    // didn't fire — consent wall or rate limit. Don't store as resolved.
    const stillGoogle = /news\.google\.com|consent\.google\.com/.test(finalUrl ?? "");
    if (stillGoogle) {
      sameAsInput++;
      console.log(`? consent/wall, stayed on google`);
      if (!DRY_RUN) {
        await sb.from("news_items").update({
          resolved_at: new Date().toISOString(),
        }).eq("id", it.id);
      }
    } else if (finalUrl) {
      resolved++;
      console.log(`✓ ${finalUrl.slice(0, 60)}`);
      if (!DRY_RUN) {
        await sb.from("news_items").update({
          resolved_url: finalUrl.slice(0, 1000),
          resolved_at: new Date().toISOString(),
        }).eq("id", it.id);
      }
    } else {
      errored++;
      console.log(`✗ no URL captured`);
    }

    await sleep(POLITE_DELAY_MS);
  }
} finally {
  await browser.close();
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — resolved=${resolved} consent-blocked=${sameAsInput} errored=${errored}`);

// scraper_runs log for /admin/intel-health
try {
  await sb.from("scraper_runs").insert({
    source: "resolve_news_urls",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: items.length === 0 ? "empty" : (errored > items.length / 2 ? "error" : "success"),
    rows_updated: resolved + sameAsInput,
    notes: `Phase 2 resolver: ${resolved} new URLs, ${sameAsInput} stuck on google, ${errored} errors`,
  });
} catch { /* best-effort */ }

process.exit(0);
