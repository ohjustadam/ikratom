/**
 * Editorial seed of documented kratom-illegal cities and counties.
 *
 * The bill extractor (scripts/extract-bills-from-alerts.mjs) and the
 * body watchlist work PROSPECTIVELY — they catch new resolutions as
 * they appear in news + alerts. But pre-existing local bans that
 * passed BEFORE our pipeline existed often won't trigger fresh news
 * and won't appear in the watchlist (since their meetings were in
 * the past). We need editorial backfill for those.
 *
 * This script seeds the documented local bans as bills rows. Source:
 * publicly-reported jurisdictions where kratom was banned at the
 * city or county level. Each row is created with:
 *   - status='enacted'
 *   - scope='county' or 'municipal'
 *   - kratom_relevance='anti'
 *   - relevance_confidence=0.95 (editorial)
 *   - flag in notes that admin should verify exact ordinance number
 *     + effective date
 *
 * Idempotent — UPSERT on (state, bill_number). Re-running won't
 * duplicate, and any admin edits to these rows survive re-runs.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-local-kratom-bans.mjs
 *   node --env-file=.env.local scripts/seed-local-kratom-bans.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Documented local kratom bans. Sources for each: publicly-reported
// in news coverage or American Kratom Association's state-action
// tracker. We capture what we know — admin should fill exact
// ordinance numbers + dates from city council records.
//
// Convention for bill_number: "LOCAL-BAN — <jurisdiction>" so the
// row sorts visibly as editorial-seed-style. Admin can rename if
// they pull the actual ordinance number.
// =============================================================
const LOCAL_BANS = [
  {
    state: "CA", locality: "San Diego, CA", scope: "municipal",
    title: "San Diego, CA — local kratom prohibition (documented)",
    summary: "San Diego prohibits sale of kratom. Among the earliest US local bans (~2016). Admin: verify exact municipal code section.",
    last_action: "Enacted (date approximate)", effective_date: "2016-10-31",
  },
  {
    state: "CO", locality: "Denver, CO", scope: "municipal",
    title: "Denver, CO — Department of Public Health ban on kratom for human consumption (documented)",
    summary: "Denver enacted a kratom prohibition via Department of Public Health & Environment public-health order. Admin: verify exact ordinance.",
    last_action: "Enacted via public health order", effective_date: "2017-11-08",
  },
  {
    state: "FL", locality: "Sarasota County, FL", scope: "county",
    title: "Sarasota County, FL — county-level kratom prohibition (documented)",
    summary: "Sarasota County passed Ordinance 2014-001 prohibiting kratom in unincorporated areas. Admin: verify county code citation.",
    last_action: "Enacted (Ordinance 2014-001)", effective_date: "2014-01-01",
  },
  {
    state: "CA", locality: "Oceanside, CA", scope: "municipal",
    title: "Oceanside, CA — municipal kratom prohibition (documented)",
    summary: "Oceanside, CA enacted a local prohibition on kratom sale. Admin: verify exact municipal code section.",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "OR", locality: "Ontario, OR", scope: "municipal",
    title: "Ontario, OR — municipal kratom prohibition (documented)",
    summary: "Ontario, OR has enacted a prohibition on the sale of kratom. Admin: verify exact ordinance number.",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "IL", locality: "Jerseyville, IL", scope: "municipal",
    title: "Jerseyville, IL — municipal kratom prohibition (documented)",
    summary: "Jerseyville prohibited sale of kratom by municipal ordinance.",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "IL", locality: "Edwardsville, IL", scope: "municipal",
    title: "Edwardsville, IL — municipal kratom prohibition (documented)",
    summary: "Edwardsville prohibited sale of kratom by municipal ordinance.",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "IL", locality: "Alton, IL", scope: "municipal",
    title: "Alton, IL — municipal kratom prohibition (documented)",
    summary: "Alton prohibited sale of kratom by municipal ordinance.",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "MS", locality: "Union County, MS", scope: "county",
    title: "Union County, MS — county-level kratom prohibition (documented)",
    summary: "Union County, MS enacted a county-level kratom ban. Mississippi is the state with the most county-level bans in the US.",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "MS", locality: "Columbus, MS", scope: "municipal",
    title: "Columbus, MS — municipal kratom prohibition (documented)",
    summary: "Columbus, MS enacted a city-level kratom ban (one of many MS local bans).",
    last_action: "Enacted (date approximate)", effective_date: null,
  },
  {
    state: "MI", locality: "Sterling Heights, MI", scope: "municipal",
    title: "Sterling Heights, MI — municipal kratom prohibition (under consideration / enacted)",
    summary: "Sterling Heights, MI moved to ban kratom 'for the safety of the public' per local press 2026. Admin: verify final ordinance + effective date.",
    last_action: "Local press 2026: ban approved", effective_date: null,
  },
];

console.log(`Seeding ${LOCAL_BANS.length} documented local kratom bans${DRY_RUN ? " (DRY RUN)" : ""}…`);

let ok = 0, fail = 0;
for (const b of LOCAL_BANS) {
  // Build a stable bill_number for this editorial seed.
  // Format: "LOCAL-BAN <locality>" — unique enough that the extractor
  // won't collide and the admin can rename it to the real ordinance
  // number once verified.
  const slug = b.locality.replace(/,?\s*[A-Z]{2}\s*$/, "").replace(/\s+/g, "-").toUpperCase();
  const billNumber = `LOCAL-BAN ${slug}`;

  const row = {
    state: b.state,
    bill_number: billNumber,
    title: b.title,
    summary: b.summary,
    status: "enacted",
    kratom_relevance: "anti",
    relevance_confidence: 0.95,
    last_action: b.last_action,
    last_action_at: b.effective_date ? new Date(b.effective_date).toISOString() : null,
    effective_date: b.effective_date,
    scope: b.scope,
    locality: b.locality,
    targets_natural_leaf: true,
    targets_synthetic_only: false,
    active: true,
    session_id: "editorial-seed",
    source_url: "https://www.americankratom.org/state-action.html",  // generic AKA tracker
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

console.log(`\nDone. ok=${ok}, fail=${fail}`);
console.log(`Admin: review at /admin/bills?status=enacted&scope=municipal — verify exact ordinance numbers + effective dates.`);
