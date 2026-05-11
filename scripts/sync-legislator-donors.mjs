#!/usr/bin/env node
/**
 * Sync federal legislator donor profiles from OpenFEC (api.open.fec.gov).
 *
 * Per-legislator flow:
 *   1. Search candidates by name + state + office (S=Senate, H=House)
 *   2. Cache the openfec_candidate_id on first match
 *   3. Pull /candidates/<id>/totals for the current cycle
 *   4. Pull /candidates/<id>/committees → principal committee_id
 *   5. Pull /schedules/schedule_a/by_industry?committee_id=Y → industries
 *   6. Categorize industries as kratom-relevant (pharma, retail, etc.)
 *
 * Cron: daily-cron.yml weekly slot would be ideal; for now run
 * manually:
 *   node --env-file=.env.local scripts/sync-legislator-donors.mjs
 *   node --env-file=.env.local scripts/sync-legislator-donors.mjs --legislator <uuid>
 *   node --env-file=.env.local scripts/sync-legislator-donors.mjs --all --limit 50
 *
 * Free tier: 1000 req/hr per api.data.gov key. Each legislator uses
 * ~4 calls → 250 legislators/hr.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const KEY = process.env.OPENFEC_API_KEY;
if (!KEY) {
  console.log("OPENFEC_API_KEY not set — skipping");
  try {
    await sb.from("scraper_runs").insert({
      source: "sync_legislator_donors",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "empty",
      notes: "OPENFEC_API_KEY not set",
    });
  } catch { /* best-effort */ }
  process.exit(0);
}

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = arg("--legislator");
const LIMIT = parseInt(arg("--limit") ?? "50", 10);

const CYCLE = new Date().getFullYear() % 2 === 0
  ? new Date().getFullYear()
  : new Date().getFullYear() + 1;

const KRATOM_RELEVANT_INDUSTRIES = {
  pharma: ["H4100", "H4200", "H4300"],         // pharmaceutical manufacturing
  retail: ["F2000", "F3000"],                  // general retail incl. convenience
  alcohol: ["N2000", "N2200"],                 // beer + wine + spirits
  tobacco: ["N3000"],                          // tobacco
  hospital_health: ["H1100", "H1300"],         // hospital + nursing home (opioid Rx volume)
};

async function fec(path, params = {}) {
  const u = new URL("https://api.open.fec.gov/v1" + path);
  u.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) { for (const x of v) u.searchParams.append(k, x); }
    else if (v != null) u.searchParams.set(k, v);
  }
  const r = await fetch(u.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`OpenFEC ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function categorizeRelevant(industries) {
  const buckets = { pharma: 0, retail: 0, alcohol: 0, tobacco: 0, hospital_health: 0, total: 0 };
  for (const i of industries) {
    buckets.total += Number(i.total ?? 0);
    for (const [bucket, codes] of Object.entries(KRATOM_RELEVANT_INDUSTRIES)) {
      if (codes.includes(i.disbursement_purpose_category_full ?? i.fec_industry)) {
        buckets[bucket] += Number(i.total ?? 0);
      }
    }
  }
  return buckets;
}

async function syncOne(leg) {
  console.log(`\n=== ${leg.state} ${leg.full_name} | ${leg.role} ===`);

  const office = leg.role === "us_senate" ? "S" : leg.role === "us_house" ? "H" : null;
  if (!office) { console.log("  ⏭  not federal"); return "skip"; }

  let candidateId = leg.openfec_candidate_id;

  if (!candidateId) {
    // Search by name + state + office
    try {
      const searchData = await fec("/candidates/search/", {
        q: leg.full_name,
        state: leg.state,
        office,
        cycle: CYCLE,
      });
      const results = searchData.results ?? [];
      if (results.length === 0) {
        console.log(`  ⏭  no OpenFEC match`);
        await sb.from("legislator_donors").upsert({
          legislator_id: leg.id,
          cycle: CYCLE,
          resolved_status: "not_found",
          resolve_notes: `Searched "${leg.full_name}" in ${leg.state} ${office} cycle ${CYCLE}`,
          synced_at: new Date().toISOString(),
        }, { onConflict: "legislator_id" });
        return "skip";
      }
      candidateId = results[0].candidate_id;
      console.log(`  ↳ resolved to ${candidateId}`);
    } catch (e) {
      console.log(`  ✗ search failed: ${e.message?.slice(0, 100)}`);
      return "fail";
    }
  }

  // Pull totals
  let totals;
  try {
    const totalsData = await fec(`/candidate/${candidateId}/totals/`, { cycle: CYCLE });
    totals = totalsData.results?.[0];
  } catch (e) {
    console.log(`  ⚠ totals failed: ${e.message?.slice(0, 100)}`);
  }

  // Find principal committee
  let committeeId;
  try {
    const commData = await fec(`/candidate/${candidateId}/committees/`, {
      cycle: CYCLE,
      designation: "P",  // P = principal committee
    });
    committeeId = commData.results?.[0]?.committee_id;
  } catch (e) {
    console.log(`  ⚠ committees failed: ${e.message?.slice(0, 100)}`);
  }

  // Industries (only if we have a committee)
  let industries = [];
  let employers = [];
  if (committeeId) {
    try {
      const indData = await fec(`/schedules/schedule_a/by_industry/`, {
        committee_id: committeeId,
        cycle: CYCLE,
        per_page: 20,
        sort: "-contribution_receipt_amount",
      });
      industries = (indData.results ?? []).map((r) => ({
        ...r,
        total: Number(r.total ?? r.contribution_receipt_amount ?? 0),
      }));
    } catch (e) {
      console.log(`  ⚠ industries failed: ${e.message?.slice(0, 100)}`);
    }
    await sleep(500);
    try {
      const empData = await fec(`/schedules/schedule_a/by_employer/`, {
        committee_id: committeeId,
        cycle: CYCLE,
        per_page: 20,
        sort: "-contribution_receipt_amount",
      });
      employers = (empData.results ?? []).map((r) => ({
        ...r,
        total: Number(r.total ?? r.contribution_receipt_amount ?? 0),
      }));
    } catch (e) {
      console.log(`  ⚠ employers failed: ${e.message?.slice(0, 100)}`);
    }
  }

  // Categorize relevance
  const relevant = categorizeRelevant(industries);

  // Persist
  const row = {
    legislator_id: leg.id,
    openfec_candidate_id: candidateId,
    cycle: CYCLE,
    total_receipts: Number(totals?.receipts ?? 0),
    total_disbursements: Number(totals?.disbursements ?? 0),
    top_industries: industries.slice(0, 10).map((i) => ({
      industry: i.disbursement_purpose_category_full ?? i.industry ?? "(unknown)",
      amount: Number(i.total ?? 0),
    })),
    top_employers: employers.slice(0, 10).map((e) => ({
      employer: e.employer ?? "(unknown)",
      amount: Number(e.total ?? 0),
    })),
    kratom_relevant: relevant,
    resolved_status: committeeId ? "matched" : "no_committee",
    synced_at: new Date().toISOString(),
  };

  const { error } = await sb.from("legislator_donors")
    .upsert(row, { onConflict: "legislator_id" });
  if (error) {
    console.log(`  ✗ db write: ${error.message}`);
    return "fail";
  }

  // Cache candidate_id back on legislator (avoids re-search next time)
  if (!leg.openfec_candidate_id) {
    await sb.from("legislators")
      .update({ openfec_candidate_id: candidateId })
      .eq("id", leg.id);
  }

  console.log(`  ✓ $${(row.total_receipts/1000).toFixed(0)}k receipts | ${industries.length} industries | pharma $${(relevant.pharma/1000).toFixed(0)}k`);
  return "ok";
}

// ---- main ----
let legislators;
if (SPECIFIC) {
  const { data } = await sb.from("legislators").select("id, full_name, state, role, openfec_candidate_id").eq("id", SPECIFIC).single();
  legislators = data ? [data] : [];
} else {
  const { data } = await sb.from("legislators")
    .select("id, full_name, state, role, openfec_candidate_id")
    .in("role", ["us_senate", "us_house"])
    .eq("active", true)
    .limit(LIMIT);
  legislators = data ?? [];
}

if (legislators.length === 0) { console.log("Nothing to sync."); process.exit(0); }
console.log(`Syncing ${legislators.length} federal legislator(s) via OpenFEC (cycle ${CYCLE})…`);

let ok = 0, fail = 0, skip = 0;
for (const leg of legislators) {
  const r = await syncOne(leg);
  if (r === "ok") ok++;
  else if (r === "fail") fail++;
  else skip++;
  await sleep(800); // polite to data.gov
}

console.log(`\nDone. ok=${ok}, skip=${skip}, fail=${fail}`);

try {
  await sb.from("scraper_runs").insert({
    source: "sync_legislator_donors",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: fail > ok ? "error" : "success",
    rows_updated: ok,
    notes: `${ok} synced, ${skip} skipped/no-match, ${fail} failed (cycle ${CYCLE})`,
  });
} catch { /* best-effort */ }
