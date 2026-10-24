/**
 * One-shot BoP scraper run. Reads enabled bop_sources and persists
 * findings. Run locally with:
 *
 *   npm run scrape:bop
 *
 * Runs daily in GitHub Actions (cron-daily.yml: bop-html-scrape). The old
 * /api/cron/daily-sync caller was dropped from the schedule ~2026-07-21.
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

console.log("Running BoP engine…");
const t0 = Date.now();
// The Playwright subset (TLS-blocked sites) has its own job,
// scrape-bop-browser.mjs; this one walks every other source.
// limit: the engine's default of 75 sources predates the state agency watch
// (~200 sources from 2026-10-23); below the source count it silently rotates,
// walking each source only every few days.
const results = await runBopEngine({ supabase, limit: 400, excludeAdapters: ["playwright_browser"] });
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

// Telemetry. Until 2026-10-21 these ~49 sources were walked only by the
// /api/cron/daily-sync route; when that route was dropped from the schedule
// (~2026-07-21) they silently stopped for three months, because nothing here
// wrote a scraper_runs row for the staleness pager to miss.
try {
  const inserted = results.reduce((a, r) => a + (r.inserted ?? 0), 0);
  const errored = results.filter((r) => r.status === "error").length;
  await supabase.from("scraper_runs").insert({
    source: "bop_html_scrape",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: errored === results.length && results.length > 0 ? "error" : inserted > 0 ? "success" : "empty",
    rows_added: inserted,
    notes: `${results.length} sources walked · ${errored} errored`,
  });
} catch { /* best-effort */ }
