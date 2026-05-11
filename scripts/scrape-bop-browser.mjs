/**
 * Browser-based BoP scraper run. Walks only sources whose adapter
 * column is 'playwright_browser' — those are the sites with TLS
 * fingerprinting that defeats Node fetch (KS/NH/MA/AR currently).
 *
 * Runs daily on GitHub Actions (.github/workflows/cron-daily.yml).
 * Can also be run locally:
 *
 *   npx playwright install chromium     # one-time
 *   npm run scrape:bop:browser
 *
 * Don't run this on Vercel — the Chromium binary is ~150MB and the
 * function would never spin up in time.
 */

import { createClient } from "@supabase/supabase-js";
import { runBopEngine } from "./lib/bop-engine.mjs";

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

if (!process.env[URL_ENV] || !process.env[KEY_ENV]) {
  console.error(`Missing ${URL_ENV} or ${KEY_ENV} in env.`);
  process.exit(1);
}

const supabase = createClient(process.env[URL_ENV], process.env[KEY_ENV], {
  auth: { persistSession: false },
});

console.log("Running BoP browser engine (Playwright sources only)…");
const t0 = Date.now();
const results = await runBopEngine({
  supabase,
  onlyAdapters: ["playwright_browser"],
  // Lower concurrency than the generic_html run because each source
  // needs its own browser context — 4 in-flight is plenty for the 4
  // TLS-blocked sites we currently have.
  concurrency: 2,
  // Lower limit for safety — we don't expect more than ~10 playwright
  // sources ever; if the table grows past that, increase explicitly.
  limit: 20,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nDone in ${elapsed}s — ${results.length} source(s) walked:\n`);
for (const r of results) {
  if (r.status === "error") {
    console.log(`  ✗ ${r.state} · ${r.source}: ${r.error}`);
  } else if (r.status === "ok") {
    console.log(`  ✓ ${r.state} · ${r.source}: ${r.inserted} new finding(s)`);
  } else {
    console.log(`  · ${r.state} · ${r.source}: no findings`);
  }
}

// Exit cleanly so any lingering browser process gets reaped.
process.exit(0);
