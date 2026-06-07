#!/usr/bin/env node
/**
 * seed-state-status.mjs — set the HUMAN-CONFIRMED canonical legal status for the
 * states we have authoritative ground truth on, as admin overrides. The public
 * StatusHeader + the home legal-status map render ONLY admin-confirmed rows, so
 * this is what actually surfaces; the unreliable auto-derivation stays internal,
 * feeding the /admin/state-status confirm queue.
 *
 * Ground truth: cross-referenced + adversarially verified 2026-06-07 via a
 * multi-source research sweep (LAPPA statutes + AKA + recent news + industry
 * trackers; statute wins on conflict; each "banned" call had to survive a
 * refutation pass). Only HIGH-confidence, not-mid-change states are seeded here.
 * Mid-change states (TN→ban Jul 1, KY→ban Jan 1, OH/UT/WY/GA/ID/IA/MA/WA, etc.)
 * are intentionally held grey for a second pass.
 *
 * KEY CORRECTIONS from the earlier seed:
 *   - KS was NOT a leaf ban: HB2365 (signed Apr 2026) scheduled only 7-OH; the
 *     natural leaf was excluded. Reclassified restricted (leaf legal, 7-OH banned).
 *   - CA stays banned (owner call): CDPH prohibits retail SALE statewide (admin
 *     adulterated-food action, not a criminal schedule) — note clarified.
 *
 * Statuses: banned · restricted (partial/age limit) · kcpa (Consumer Protection
 * Act — legal+regulated) · legal (no statute). admin_7oh_status left null where
 * we don't assert a verified 7-OH-specific fact.
 *
 * Upsert touches only the admin_* columns + confirmed_at, preserving derived_*.
 *
 *   node --env-file=.env.local scripts/seed-state-status.mjs          # dry-run (read-only)
 *   node --env-file=.env.local scripts/seed-state-status.mjs --apply  # write to prod (needs owner OK)
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const BAN_NOTE =
  "Statewide statutory ban on natural-leaf kratom (mitragynine scheduled). Objective legality data, not legal advice — verify against the state statute.";
const KCPA_NOTE =
  "Natural-leaf kratom is legal but regulated under a Kratom Consumer Protection Act (age limit + labeling). Objective legality data, not legal advice.";
const RESTRICTED_NOTE =
  "Natural-leaf kratom is legal but subject to a partial restriction (typically an age limit) — no statewide ban and no full Consumer Protection Act. Objective legality data, not legal advice.";
const LEGAL_NOTE =
  "No kratom-specific statute — natural-leaf kratom is legal and unregulated. Objective legality data, not legal advice.";

// Per-state notes where the basis is specific (cross-referenced 2026-06-07).
const NOTES = {
  CA: "California prohibits retail sale and manufacture of kratom statewide via CDPH adulterated-food enforcement (Gov. Newsom announced 95% compliance, 2026). It is an administrative sales prohibition rather than a criminal schedule, and a Consumer Protection Act (AB 1088) is pending — but in practice kratom cannot be legally purchased in CA.",
  CT: "Connecticut enacted a statewide Schedule I ban on Mitragyna speciosa (leaf, stem, extract), effective Mar 25, 2026.",
  LA: "Louisiana Act 41 (SB154, effective Aug 1, 2025) added mitragynine, 7-OH, and the kratom plant to Schedule I — a full statewide leaf ban.",
  KS: "Kansas HB2365 (signed Apr 10, 2026, effective Jul 1, 2026) schedules ONLY 7-OH; the natural leaf was excluded from the enacted bill, so kratom leaf remains legal (some local 21+ limits). Corrected from an earlier 'banned' listing after statute review.",
  AZ: "Arizona KCPA (A.R.S. 36-795, 2019): leaf legal, 18+, labeling; 7-OH capped, synthetics banned.",
  CO: "Colorado KCPA (C.R.S. 18-13-132 + SB25-072, the Daniel Bregger Act, 2025): leaf legal, 21+, registration.",
  FL: "Florida KCPA (Fla. Stat. 500.92, 2023): leaf legal, 21+, FDACS labeling. An Aug 2025 rule bans only concentrated 7-OH, not the leaf.",
  MD: "Maryland KCPA (HB1229, effective Oct 2024): leaf legal, 21+, labeling.",
  MS: "Mississippi KCPA (HB1077, effective Jul 2025): leaf legal, 21+, behind-the-counter.",
  NE: "Nebraska KCPA (LB230, effective Jan 2026): leaf legal, 21+, processor/retailer registry.",
  NV: "Nevada KCPA (NRS 597.998, 2019): leaf legal, 18+, labeling. A 2026 scheduling attempt was withdrawn.",
  NY: "New York KCPA-style law (signed Dec 2025): leaf legal, 21+, labeling.",
  OK: "Oklahoma KCPA (63 O.S. 1-1432.1 + SB891, 2025): leaf legal, 18+; 7-OH capped at 1%.",
  OR: "Oregon KCPA (ORS 475.394, HB4010, 2022): leaf legal, 21+, processor registration.",
  SC: "South Carolina KCPA (Act 35 / S221, effective Jul 2025): leaf legal, 21+, labeling.",
  SD: "South Dakota KCPA (HB1056, 2025): leaf legal, 21+, labeling.",
  TX: "Texas KCPA (Health & Safety Code Ch. 444, 2023): leaf legal, 18+, labeling.",
  VA: "Virginia KCPA (HB1842, 2023): leaf legal, 21+, lab testing. HB360 (effective Jul 1, 2026) bans only 7-OH, not the leaf.",
  WV: "West Virginia KCPA (W. Va. Code 19-12F; SB220/2023, SB985/2026): leaf legal, 21+, permits.",
  IL: "Illinois Kratom Control Act (720 ILCS 642): an under-18 sale ban only — no statewide leaf ban and no full Consumer Protection Act.",
  MN: "Minnesota (Minn. Stat. 152.027): sale-to-minors ban only; the age limit rises to 21 on Aug 1, 2026. No leaf ban.",
  NC: "North Carolina (HB747, 2016): under-18 sale ban + age verification only. No statewide leaf ban.",
  RI: "Rhode Island reversed its kratom ban (effective Apr 1, 2026) — natural-leaf kratom is legal, now regulated (21+, retailer licensing).",
  MI: "Kratom is currently legal in Michigan. A House-passed ban (HB 5537, 2026) is pending in the Senate — a live threat to track, not current law.",
};

const mk = (states, leaf, sevenoh, fallbackNote) =>
  states.map((state) => ({
    state,
    admin_leaf_status: leaf,
    admin_7oh_status: typeof sevenoh === "function" ? sevenoh(state) : sevenoh,
    admin_note: NOTES[state] ?? fallbackNote,
  }));

const SEED = [
  // Statewide leaf bans (KS removed — see corrections above)
  ...mk(["AL", "AR", "CA", "CT", "IN", "LA", "VT", "WI"], "banned", "banned", BAN_NOTE),
  // Kratom Consumer Protection Act states — leaf legal + regulated
  ...mk(["AZ", "CO", "FL", "MD", "MS", "NE", "NV", "NY", "OK", "OR", "SC", "SD", "TX", "VA", "WV"], "kcpa", null, KCPA_NOTE),
  // Partial restriction only (age limit) — leaf legal
  ...mk(["IL", "MN", "NC"], "restricted", null, RESTRICTED_NOTE),
  // No statute — legal and unregulated
  ...mk(["AK", "HI", "ME", "MT", "NJ", "NM", "ND", "PA"], "legal", null, LEGAL_NOTE),
  // Special cases
  { state: "KS", admin_leaf_status: "restricted", admin_7oh_status: "banned", admin_note: NOTES.KS },
  { state: "RI", admin_leaf_status: "legal", admin_7oh_status: null, admin_note: NOTES.RI },
  { state: "MI", admin_leaf_status: "legal", admin_7oh_status: null, admin_note: NOTES.MI },
];

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const byStatus = (s) => SEED.filter((r) => r.admin_leaf_status === s).map((r) => r.state).join(" ");
console.log(`Seed ${SEED.length} admin-confirmed state statuses${APPLY ? " [APPLY]" : " [dry-run]"}:`);
console.log(`  banned     (${SEED.filter((r) => r.admin_leaf_status === "banned").length}): ${byStatus("banned")}`);
console.log(`  kcpa       (${SEED.filter((r) => r.admin_leaf_status === "kcpa").length}): ${byStatus("kcpa")}`);
console.log(`  restricted (${SEED.filter((r) => r.admin_leaf_status === "restricted").length}): ${byStatus("restricted")}`);
console.log(`  legal      (${SEED.filter((r) => r.admin_leaf_status === "legal").length}): ${byStatus("legal")}`);

if (!APPLY) {
  console.log("\n(dry-run — re-run with --apply to write. Mid-change states held grey: TN KY OH UT WY GA ID IA MA MO WA DE DC NH.)");
  process.exit(0);
}

let ok = 0, fail = 0;
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
