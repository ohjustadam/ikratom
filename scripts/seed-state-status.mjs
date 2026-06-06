#!/usr/bin/env node
/**
 * seed-state-status.mjs — set the HUMAN-CONFIRMED canonical legal status for the
 * states we have authoritative ground truth on, as admin overrides. The public
 * StatusHeader renders ONLY admin-confirmed rows, so this is what actually
 * surfaces; the unreliable auto-derivation (see fix/data-accuracy) stays
 * internal, feeding the /admin/state-status confirm queue.
 *
 * Ground truth: STATE_MISSION_CONTROL_PLAN §1 (verified 2026-06-01):
 *   9 statewide statutory ban states + RI (reversed its ban → legal).
 * CA is intentionally NOT seeded — the internal docs conflict (banned vs legal
 * market); confirm it via /admin/state-status before publishing. TN omitted —
 * its ban was awaiting the governor's signature (pending, not enacted).
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

const SEED = [
  ...["AL", "AR", "CT", "IN", "KS", "LA", "MI", "VT", "WI"].map((state) => ({
    state,
    admin_leaf_status: "banned",
    admin_7oh_status: "banned",
    admin_note: BAN_NOTE,
  })),
  {
    state: "RI",
    admin_leaf_status: "legal",
    admin_7oh_status: null,
    admin_note:
      "Rhode Island reversed its kratom ban (2026) — natural-leaf kratom is legal. Verify against current state law.",
  },
];

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

console.log(`Seed ${SEED.length} admin-confirmed state statuses${APPLY ? " [APPLY]" : " [dry-run]"}:\n`);
for (const r of SEED) console.log(`  ${r.state.padEnd(3)} leaf=${r.admin_leaf_status}  7oh=${r.admin_7oh_status ?? "-"}`);

if (!APPLY) {
  console.log("\n(dry-run — re-run with --apply to write. CA excluded pending owner confirmation; TN omitted as pending.)");
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
