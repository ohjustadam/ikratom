#!/usr/bin/env node
/**
 * One-shot backfill of bills.current_committee_name from
 * bills.last_action text.
 *
 * Why: migration 0123 backfilled from bill_actions, but only ~22 rows
 * exist in bill_actions (LegiScan path is hourly + key-gated). The
 * other ~150 active state bills that have committee mentions live in
 * the OpenStates-sourced bills.last_action text snapshot. This script
 * reads each one, runs the same Form A / Form B parser as
 * src/lib/bill-committee.ts, and writes the column.
 *
 * Idempotent: only updates rows where current_committee_name is null.
 * Safe to re-run.
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-bill-committees.mjs
 *   node --env-file=.env.local scripts/backfill-bill-committees.mjs --dry-run
 *
 * After this runs, ongoing freshness comes from:
 *   - LegiScan hourly sync (PR #224) for the priority bills it tracks
 *   - This script re-run if/when OpenStates rolls out new last_action text
 *     for non-LegiScan-tracked bills (run weekly via cron if needed)
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DRY = process.argv.includes("--dry-run");

// Same Form A / Form B parser as src/lib/bill-committee.ts. Inline
// here so the .mjs script is self-contained (matches the pattern
// every other scripts/ entry uses).
const COMMITTEE_RE_A = /((?:Senate|House|Assembly|Joint)(?:(?!Senate|House|Assembly|Joint)[^.;]){2,80}?Committee)/i;
const COMMITTEE_RE_B = /(Senate|House|Assembly|Joint)\s+Committee\s+on\s+((?:(?!Senate|House|Assembly|Joint)[^.;,]){2,60}?)(?=\s*[.;,]|$)/i;

function parseCommittee(desc) {
  if (!desc) return null;
  const a = String(desc).match(COMMITTEE_RE_A);
  if (a) {
    const raw = a[1].trim();
    if (raw.length >= 8 && raw.length <= 80) {
      const chamber = /^senate/i.test(raw) ? "senate"
        : /^(house|assembly)/i.test(raw) ? "house"
        : /^joint/i.test(raw) ? "joint"
        : null;
      return { name: raw, chamber };
    }
  }
  const b = String(desc).match(COMMITTEE_RE_B);
  if (b) {
    const chamberRaw = b[1].trim();
    const body = b[2].trim().replace(/\s+/g, " ");
    if (body.length >= 3 && body.length <= 60) {
      const chamberCanonical = /^senate/i.test(chamberRaw) ? "Senate"
        : /^(house|assembly)/i.test(chamberRaw) ? chamberRaw[0].toUpperCase() + chamberRaw.slice(1).toLowerCase()
        : "Joint";
      const name = `${chamberCanonical} ${body} Committee`;
      if (name.length >= 8 && name.length <= 80) {
        const chamber = /^senate/i.test(chamberRaw) ? "senate"
          : /^(house|assembly)/i.test(chamberRaw) ? "house"
          : "joint";
        return { name, chamber };
      }
    }
  }
  return null;
}

// Pull every active bill with a committee mention in last_action and
// no current_committee_name yet. Cap at 5000 so the script stays
// safe even when the active set grows.
const { data: bills, error } = await sb
  .from("bills")
  .select("id, state, bill_number, last_action, last_action_at")
  .eq("active", true)
  .ilike("last_action", "%committee%")
  .is("current_committee_name", null)
  .limit(5000);

if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}

console.log(`Scanning ${bills?.length ?? 0} candidate bill(s)${DRY ? " (DRY RUN)" : ""}…`);

let matched = 0;
let writeOk = 0;
let writeFail = 0;
const samples = [];

for (const bill of bills ?? []) {
  const parsed = parseCommittee(bill.last_action);
  if (!parsed) continue;
  matched++;
  if (samples.length < 8) {
    samples.push({ state: bill.state, num: bill.bill_number, name: parsed.name, src: String(bill.last_action).slice(0, 80) });
  }
  if (DRY) continue;
  const { error: upErr } = await sb
    .from("bills")
    .update({
      current_committee_name: parsed.name,
      current_committee_chamber: parsed.chamber,
      current_committee_updated_at: bill.last_action_at,
    })
    .eq("id", bill.id);
  if (upErr) {
    writeFail++;
    if (writeFail <= 3) console.error(`  ✗ ${bill.state} ${bill.bill_number}: ${upErr.message?.slice(0, 100)}`);
  } else {
    writeOk++;
  }
}

console.log(`\nResults:`);
console.log(`  candidates:       ${bills?.length ?? 0}`);
console.log(`  parsed a name:    ${matched}`);
console.log(`  wrote OK:         ${writeOk}${DRY ? " (skipped, dry run)" : ""}`);
console.log(`  write failures:   ${writeFail}`);

if (samples.length > 0) {
  console.log(`\nSamples:`);
  for (const s of samples) {
    console.log(`  ${s.state} ${s.num} → ${s.name}`);
    console.log(`    src: ${s.src}`);
  }
}

process.exit(writeFail > 0 ? 2 : 0);
