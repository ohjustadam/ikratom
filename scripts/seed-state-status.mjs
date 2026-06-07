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
 * refutation pass). All 50 states + DC are now seeded (the 2026-06-07 second
 * pass cleared the previously-held mid-change states at their CURRENT status).
 * Future-dated changes (TN→ban Jul 1, KY→ban Jan 1, VA 7-OH Jul 1, MN age Aug 1)
 * are tracked in state_status_flips (migration 0179) and surfaced into the
 * confirm queue on their effective dates by queue-due-state-flips.mjs.
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
  // Held states cleared in the 2026-06-07 second pass (current status; future flips tracked in state_status_flips).
  GA: "Georgia KCPA (GA Code 16-13-120, 2019): leaf legal, 21+ (since 2025), labeling. A repeal/ban bill (HB968) is pending — a live threat, not law.",
  KY: "Kentucky KCPA (HB293, 2024): leaf legal, 21+. ⚠ HB757 repeals the KCPA and bans sales effective Jan 1, 2027 (under a constitutional challenge).",
  OH: "Ohio KCPA (HB236, 2025): leaf legal, age verification + labeling. A May 2026 rule schedules only 7-OH/synthetic forms — not the natural leaf.",
  TN: "Tennessee KCPA (T.C.A. 39-17-452): leaf legal + regulated today. ⚠ A statewide ban on the natural leaf (HB1649) takes effect July 1, 2026.",
  UT: "Utah KCPA (Title 4 Ch. 45 + SB45, 2026): leaf legal, 21+, specialty shops only. A full ban was explicitly rejected; only synthetic/high-7-OH products are banned.",
  WY: "Wyoming KCPA (SF0056, signed Mar 2026, effective Jul 1 2026): leaf legal, 21+, labeling, 7-OH capped at 2%.",
  DE: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. Competing ban (SB262) and KCPA (HB332) bills are pending, not enacted.",
  ID: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. 2026 bills failed; only local city ordinances exist.",
  IA: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. A 2026 Schedule I ban passed the House but died in the Senate.",
  MA: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. 2026 ban/KCPA bills are pending; only local bans exist.",
  MO: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. The 2022 KCPA was vetoed; restrictions are local only.",
  NH: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. The 2026 regulation bill (SB557) failed; only local ordinances exist.",
  WA: "No kratom-specific statute — natural-leaf kratom is legal and unregulated. 2026 regulation/tax bills died; only local city bans exist.",
  DC: "Washington, D.C. schedules only 7-OH (since 2016); the natural leaf is legal. No Consumer Protection Act.",
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
  ...mk(["AZ", "CO", "FL", "GA", "KY", "MD", "MS", "NE", "NV", "NY", "OH", "OK", "OR", "SC", "SD", "TN", "TX", "UT", "VA", "WV", "WY"], "kcpa", null, KCPA_NOTE),
  // Partial restriction only (age limit) — leaf legal
  ...mk(["IL", "MN", "NC"], "restricted", null, RESTRICTED_NOTE),
  // No statute — legal and unregulated
  ...mk(["AK", "DE", "HI", "IA", "ID", "MA", "ME", "MO", "MT", "NH", "NJ", "NM", "ND", "PA", "WA"], "legal", null, LEGAL_NOTE),
  // Special cases
  { state: "KS", admin_leaf_status: "restricted", admin_7oh_status: "banned", admin_note: NOTES.KS },
  { state: "DC", admin_leaf_status: "legal", admin_7oh_status: "banned", admin_note: NOTES.DC },
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
  console.log("\n(dry-run — re-run with --apply to write. All 50 states + DC seeded; future-dated flips tracked in state_status_flips / queue-due-state-flips.mjs.)");
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
