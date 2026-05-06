#!/usr/bin/env node
/**
 * Backfill bills.session_id from existing source_url where possible.
 *
 * Pattern: OpenStates URLs look like
 *   https://openstates.org/<state>/bills/<session>/<bill_number>/
 * The path segment after "bills" is the session identifier.
 *
 * For rows where the pattern doesn't match (legacy or hand-entered), we
 * leave session_id NULL — the auto-create gate filters those out
 * automatically, so they're effectively quarantined until a future cron
 * run re-syncs them with proper session info.
 *
 * Run with:  node --env-file=.env.local scripts/backfill-bill-sessions.mjs
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PATTERN = /openstates\.org\/[a-z]{2}\/bills\/([^/?#]+)\//i;

console.log("Scanning bills with NULL session_id…");
const { data: bills, error } = await supabase
  .from("bills")
  .select("id, state, bill_number, source_url, session_id")
  .is("session_id", null);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

console.log(`Found ${bills.length} bills missing session_id.`);

let updated = 0;
let unmatched = 0;
const unmatchedSamples = [];

for (const b of bills) {
  if (!b.source_url) {
    unmatched++;
    if (unmatchedSamples.length < 5) {
      unmatchedSamples.push(`${b.state} ${b.bill_number} — no source_url`);
    }
    continue;
  }
  const m = b.source_url.match(PATTERN);
  if (!m) {
    unmatched++;
    if (unmatchedSamples.length < 5) {
      unmatchedSamples.push(`${b.state} ${b.bill_number} — ${b.source_url.slice(0, 80)}`);
    }
    continue;
  }
  const session = m[1];
  const { error: updateErr } = await supabase
    .from("bills")
    .update({ session_id: session })
    .eq("id", b.id);
  if (updateErr) {
    console.error(`  Update failed for ${b.state} ${b.bill_number}:`, updateErr.message);
    continue;
  }
  updated++;
  if (updated <= 5) {
    console.log(`  ${b.state} ${b.bill_number} → session ${session}`);
  }
}

console.log(`\nDone. Updated: ${updated}. Unmatched: ${unmatched}.`);
if (unmatchedSamples.length > 0) {
  console.log(`Unmatched samples (kept as NULL — will populate on next cron sync):`);
  unmatchedSamples.forEach((s) => console.log(`  ${s}`));
}
