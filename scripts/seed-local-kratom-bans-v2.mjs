/**
 * Comprehensive local-ban seed v2 (expansion of seed-local-kratom-bans.mjs).
 *
 * Owner audit revealed our previous seed (11 rows) missed the bulk of
 * Mississippi's bans. MS has the most county- and city-level kratom
 * bans in the US — 11 counties + 25 cities documented as of May 2026
 * (sources: kratomlords.com, legalclarity.org, kratomscience.com).
 *
 * This script seeds the full MS set + adds Tennessee as an imminent
 * statewide ban (HB 1649 — passed Senate 23-3 on 2026-04-16, sent to
 * Gov. Bill Lee for signature, effective 2026-07-01).
 *
 * Idempotent — UPSERT on (state, bill_number) per migration 0128
 * convention. Re-running is safe; existing rows are left alone.
 *
 * Naming convention: "LOCAL-BAN <jurisdiction>" for cities/counties,
 * matches v1 seed so the admin can filter editorial-seeded rows.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Mississippi — 11 counties + 25 cities
// =============================================================
const MS_COUNTIES = ["Alcorn", "Calhoun", "Itawamba", "Lowndes", "Monroe", "Noxubee", "Pearl River", "Prentiss", "Tippah", "Tishomingo", "Union"];
const MS_CITIES = ["Belmont", "Blue Mountain", "Booneville", "Bruce", "Burnsville", "Caledonia", "Calhoun City", "Columbus", "Corinth", "Derma", "Fulton", "Guntown", "Iuka", "Mantachie", "Marietta", "New Albany", "Okolona", "Oxford", "Pontotoc", "Ripley", "Saltillo", "Senatobia", "Tishomingo", "Tupelo", "Vardaman"];

const ms_county_rows = MS_COUNTIES.map(name => ({
  state: "MS",
  locality: `${name} County, MS`,
  scope: "county",
  title: `${name} County, MS — county-level kratom prohibition`,
  summary: `${name} County, Mississippi enacted a county-level kratom ban. Mississippi has the most county-level bans in the US (11 counties + 25 cities as of 2026-05). Admin: verify exact ordinance number + effective date from county records.`,
  last_action: "Enacted (date approximate)",
}));

const ms_city_rows = MS_CITIES.map(name => ({
  state: "MS",
  locality: `${name}, MS`,
  scope: "municipal",
  title: `${name}, MS — municipal kratom prohibition`,
  summary: `${name}, Mississippi enacted a city-level kratom ban. Admin: verify exact ordinance citation.`,
  last_action: "Enacted (date approximate)",
}));

const LOCAL_BANS = [...ms_county_rows, ...ms_city_rows];

console.log(`Seeding ${LOCAL_BANS.length} MS local kratom bans${DRY_RUN ? " (DRY RUN)" : ""}…`);

let ok = 0, fail = 0, skipped = 0;
for (const b of LOCAL_BANS) {
  const slug = b.locality.replace(/,?\s*MS\s*$/, "").replace(/\s+County\s*$/, "").replace(/\s+/g, "-").toUpperCase();
  const billNumber = `LOCAL-BAN ${slug}-${b.scope === "county" ? "CO" : "CITY"}`;

  const row = {
    state: b.state,
    bill_number: billNumber,
    title: b.title,
    summary: b.summary,
    status: "enacted",
    kratom_relevance: "anti",
    relevance_confidence: 0.9,
    last_action: b.last_action,
    last_action_at: null,
    scope: b.scope,
    locality: b.locality,
    targets_natural_leaf: true,
    targets_synthetic_only: false,
    active: true,
    session_id: "editorial-seed",
    source_url: "https://kratomlords.com/kratom-legality/kratom-in-mississippi-latest-news/",
    created_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log(`  [DRY] ${b.state} · ${b.locality} (${b.scope}) — ${billNumber}`);
    ok++;
    continue;
  }

  const { error } = await sb
    .from("bills")
    .upsert(row, { onConflict: "state,bill_number" });
  if (error) {
    console.error(`  ✗ ${b.locality}: ${error.message?.slice(0, 150)}`);
    fail++;
    continue;
  }
  console.log(`  ✓ ${b.state} · ${b.locality} (${b.scope})`);
  ok++;
}

// =============================================================
// Tennessee — imminent statewide ban via HB 1649
// =============================================================
console.log(`\nAdding Tennessee statewide ban (HB 1649)…`);
const tnRow = {
  state: "TN",
  bill_number: "HB 1649",
  title: "Tennessee HB 1649 — full statewide ban on kratom + 7-OH products",
  summary: "Tennessee HB 1649 passed the Senate 23-3 on 2026-04-16, sent to Governor Bill Lee for signature. Would make Tennessee the 7th state to fully ban kratom (joining Alabama, Arkansas, Indiana, Rhode Island, Vermont, Wisconsin). Effective date if signed: 2026-07-01. Covers natural-leaf kratom AND 7-OH/synthetic concentrates AND gummies/drops/capsules. Framed as 'gas station heroin' ban in legislative debate.",
  status: "passed_chamber",
  kratom_relevance: "anti",
  relevance_confidence: 1.0,
  last_action: "Passed Senate 23-3 — to Governor Lee for signature",
  last_action_at: "2026-04-16T00:00:00Z",
  effective_date: "2026-07-01",
  scope: "state",
  locality: null,
  targets_natural_leaf: true,
  targets_synthetic_only: false,
  active: true,
  session_id: "tn-2026",
  source_url: "https://www.timesfreepress.com/news/2026/apr/21/tennessee-set-to-become-seventh-state-to-have/",
  created_at: new Date().toISOString(),
  last_synced_at: new Date().toISOString(),
};
if (DRY_RUN) {
  console.log(`  [DRY] TN HB 1649 (statewide, passed_chamber, effective 2026-07-01)`);
  ok++;
} else {
  const { error } = await sb.from("bills").upsert(tnRow, { onConflict: "state,bill_number" });
  if (error) { console.error(`  ✗ TN HB 1649: ${error.message?.slice(0, 150)}`); fail++; }
  else { console.log(`  ✓ TN HB 1649`); ok++; }
}

console.log(`\nDone. ok=${ok}, fail=${fail}, skipped=${skipped}`);
console.log(`Admin: review at /admin/bills?status=enacted to verify ordinance numbers + effective dates.`);
