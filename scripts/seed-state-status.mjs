#!/usr/bin/env node
/**
 * seed-state-status.mjs — set the HUMAN-CONFIRMED canonical legal status for the
 * states we have authoritative ground truth on, as admin overrides. The public
 * StatusHeader renders ONLY admin-confirmed rows, so this is what actually
 * surfaces; the unreliable auto-derivation (see fix/data-accuracy) stays
 * internal, feeding the /admin/state-status confirm queue.
 *
 * Ground truth cross-referenced 2026-06-06 (gov.ca.gov + AKA/independent 2026
 * trackers; statute wins on conflict):
 *   BANNED (9): AL, AR, CA, CT, IN, KS, LA, VT, WI  (CA bans leaf+7-OH; KS ban
 *     signed Apr 2026, effective Jul 1).
 *   LEGAL (2): RI (reversed its ban Apr 2026), MI (House-passed ban pending the
 *     Senate — NOT law; seeded legal with the threat noted).
 *   TN omitted — its ban was pending the governor's signature (not enacted).
 *
 * Upsert touches only the admin_* columns, preserving derived_* from the cron.
 *
 *   node --env-file=.env.local scripts/seed-state-status.mjs          # dry-run (read-only)
 *   node --env-file=.env.local scripts/seed-state-status.mjs --apply  # write to prod (needs owner OK)
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const BAN_NOTE =
  "Statewide statutory ban on natural-leaf kratom. Verify against the state statute — objective legality data, not legal advice.";

// Per-state notes where the basis is specific (cross-referenced 2026-06-06).
const NOTES = {
  CA: "California prohibits the sale/manufacture of kratom AND 7-OH products statewide (CDPH 2025 consumer warning + enforcement; Gov. Newsom announced 95% compliance, 2026). Verify against state law.",
  KS: "Kansas ban signed Apr 10, 2026 (Gov. Kelly), effective July 1, 2026 — schedules 7-OH, effectively banning commercial kratom. Verify against the statute.",
};

// Cross-referenced 2026-06-06 vs gov.ca.gov + AKA/independent 2026 trackers.
// 9 statewide bans (incl. CA + the newly-enacted KS); MI is NOT banned — its
// House-passed ban (HB 5537) is pending the Senate, so it's seeded legal with
// the threat noted (the pending bill still surfaces in the page's "fight"
// section). TN omitted (was pending the governor's signature).
const SEED = [
  ...["AL", "AR", "CA", "CT", "IN", "KS", "LA", "VT", "WI"].map((state) => ({
    state,
    admin_leaf_status: "banned",
    admin_7oh_status: "banned",
    admin_note: NOTES[state] ?? BAN_NOTE,
  })),
  {
    state: "RI",
    admin_leaf_status: "legal",
    admin_7oh_status: null,
    admin_note:
      "Rhode Island reversed its kratom ban (effective Apr 1, 2026) — natural-leaf kratom is legal. Verify against current state law.",
  },
  {
    state: "MI",
    admin_leaf_status: "legal",
    admin_7oh_status: null,
    admin_note:
      "Kratom is currently legal in Michigan. A House-passed ban (HB 5537, 2026) is pending in the Senate — a live threat to track, not current law.",
  },
];

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

console.log(`Seed ${SEED.length} admin-confirmed state statuses${APPLY ? " [APPLY]" : " [dry-run]"}:\n`);
for (const r of SEED) console.log(`  ${r.state.padEnd(3)} leaf=${r.admin_leaf_status}  7oh=${r.admin_7oh_status ?? "-"}`);

if (!APPLY) {
  console.log("\n(dry-run — re-run with --apply to write. CA included (confirmed banned); MI seeded legal (House ban pending); TN omitted as pending.)");
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const r of SEED) {
  const { error } = await sb
    .from("state_status")
    .upsert(
      {
        state: r.state,
        admin_leaf_status: r.admin_leaf_status,
        admin_7oh_status: r.admin_7oh_status,
        admin_note: r.admin_note,
        confirmed_at: NOW,
        updated_at: NOW,
      },
      { onConflict: "state" },
    );
  if (error) { console.error(`  ✗ ${r.state}: ${error.message}`); fail++; } else ok++;
}
console.log(`\n✅ Seeded ${ok} admin-confirmed statuses (${fail} failed).`);
process.exit(fail ? 1 : 0);
