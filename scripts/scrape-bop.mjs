/**
 * One-shot BoP scraper run. Reads enabled bop_sources and persists
 * findings. Run locally with:
 *
 *   npm run scrape:bop
 *
 * The daily cron at /api/cron/daily-sync also calls runBopEngine.
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
const results = await runBopEngine({ supabase });
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
