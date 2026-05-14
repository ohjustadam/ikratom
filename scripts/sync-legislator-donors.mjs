#!/usr/bin/env node
/**
 * Sync federal legislator donor profiles from OpenFEC (api.open.fec.gov).
 *
 * Per-legislator flow:
 *   1. Search candidates by name + state + office (S=Senate, H=House)
 *   2. Cache the openfec_candidate_id on first match
 *   3. Pull /candidates/<id>/totals for the current cycle
 *   4. Pull /candidates/<id>/committees → principal committee_id
 *   5. Pull /schedules/schedule_a/by_employer?committee_id=Y → top donors
 *   6. Categorize employers as kratom-relevant (pharma, retail, etc.)
 *      via brand-name substring match. OpenFEC has no industry
 *      aggregation endpoint — industry data is OpenSecrets, not FEC.
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
// --all-federal processes every active us_senate + us_house legislator
// in one run. ~700 calls @ 4/leg = ~2800 API calls; well under the
// 1000/hr free tier limit with the 800ms sleep between legs (= ~3.5/sec).
// Use this for first-time backfill; daily cron stays on --limit 50 to
// refresh stale entries.
const ALL_FEDERAL = args.includes("--all-federal");
// --skip-cached avoids re-syncing legislators who already have a
// resolved (matched|not_found) row — useful when re-running after a
// partial-success crash.
const SKIP_CACHED = args.includes("--skip-cached");

const CYCLE = new Date().getFullYear() % 2 === 0
  ? new Date().getFullYear()
  : new Date().getFullYear() + 1;

// Employer-name → kratom-relevance bucket. Matched case-insensitively
// as substrings against employer names from FEC schedule_a/by_employer.
// (OpenFEC has no industry-aggregation endpoint; industry data is
// OpenSecrets, not FEC. Matching against well-known employer brand
// names is what FEC actually exposes via the by_employer aggregation.)
//
// Conservative list — only well-known industry-leader brands. Misses
// the long tail of small donors but captures the major-corporate-PAC
// money that matters for conflict-of-interest signaling. Expand here
// as new patterns emerge from real data.
const EMPLOYER_BUCKETS = {
  pharma: [
    "pfizer", "merck", "johnson & johnson", "j&j ", "novartis", "roche",
    "abbvie", "bristol myers", "bristol-myers", "eli lilly", "lilly ",
    "gilead", "amgen", "biogen", "regeneron", "vertex pharma", "moderna",
    "phrma", "pharmaceutical research", "biotech",
    "pharmaceutical", "pharma ", "biopharma",
  ],
  alcohol: [
    "anheuser-busch", "anheuser busch", "ab inbev", "diageo",
    "molson coors", "constellation brands", "brown-forman", "brown forman",
    "heineken", "bacardi", "pernod ricard",
    "beer ", "wine ", "liquor", "distilled spirits", "alcohol",
    "brewers", "vintners",
  ],
  tobacco: [
    "altria", "philip morris", "reynolds american", "british american tobacco",
    "swedish match", "imperial brands",
    "tobacco", "cigarette", "vapor",
  ],
  retail: [
    "walmart", "amazon", "target corp", "kroger", "costco", "walgreens",
    "cvs ", "cvs health", "rite aid", "national retail federation",
    "convenience stores", "nacs ",
  ],
  hospital_health: [
    "hca healthcare", "hca ", "ascension", "cleveland clinic", "mayo clinic",
    "kaiser permanente", "tenet healthcare", "universal health services",
    "american hospital association", "aha ",
  ],
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

// Categorize by employer name. Matches substrings case-insensitively
// against the EMPLOYER_BUCKETS lookup. Returns aggregate totals per
// bucket so the briefing UI can flag conflict-of-interest signals.
function categorizeRelevant(employers) {
  const buckets = { pharma: 0, retail: 0, alcohol: 0, tobacco: 0, hospital_health: 0, total: 0 };
  for (const e of employers) {
    const amount = Number(e.total ?? 0);
    buckets.total += amount;
    const name = String(e.employer ?? "").toLowerCase();
    if (!name) continue;
    for (const [bucket, patterns] of Object.entries(EMPLOYER_BUCKETS)) {
      if (patterns.some((p) => name.includes(p))) {
        buckets[bucket] += amount;
        break; // employer goes into at most one bucket; first match wins
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
      // Prefer incumbents (incumbent_challenge='I') when multiple
      // candidates match — challengers, withdrawn candidates, and
      // open-seat candidates all show up in /candidates/search/ for
      // the same name. Fall back to first result if no incumbent
      // flag is present.
      const incumbent = results.find((r) => r.incumbent_challenge === "I");
      const exactNameMatch = results.find((r) =>
        (r.name ?? "").toLowerCase().includes(leg.full_name.toLowerCase()) ||
        leg.full_name.toLowerCase().includes((r.name ?? "").toLowerCase())
      );
      const chosen = incumbent ?? exactNameMatch ?? results[0];
      candidateId = chosen.candidate_id;
      const matchReason = incumbent ? "incumbent" : exactNameMatch ? "exact-name" : "first-result";
      console.log(`  ↳ resolved to ${candidateId} (${matchReason}, ${results.length} total candidate${results.length === 1 ? "" : "s"})`);
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

  // Employers (only if we have a committee). OpenFEC has no industry-
  // aggregation endpoint; we derive industry buckets from employer
  // names below via categorizeRelevant.
  //
  // Previously also called /schedules/schedule_a/by_industry/ — that
  // endpoint returns 500 (industry data is OpenSecrets, not FEC). Also
  // used sort '-contribution_receipt_amount' which is 422; only
  // committee_id, count, cycle, employer, employer_text, idx, and
  // total are valid sort fields here.
  let employers = [];
  if (committeeId) {
    try {
      const empData = await fec(`/schedules/schedule_a/by_employer/`, {
        committee_id: committeeId,
        cycle: CYCLE,
        per_page: 100,
        sort: "-total",
      });
      employers = (empData.results ?? []).map((r) => ({
        employer: r.employer,
        total: Number(r.total ?? 0),
        count: Number(r.count ?? 0),
      }));
    } catch (e) {
      console.log(`  ⚠ employers failed: ${e.message?.slice(0, 100)}`);
    }
  }

  // Categorize relevance by matching employer names against bucket
  // patterns (pharma / alcohol / tobacco / retail / hospital_health).
  const relevant = categorizeRelevant(employers);

  // Persist
  const row = {
    legislator_id: leg.id,
    openfec_candidate_id: candidateId,
    cycle: CYCLE,
    total_receipts: Number(totals?.receipts ?? 0),
    total_disbursements: Number(totals?.disbursements ?? 0),
    // top_industries kept as empty array for schema backward compat —
    // OpenFEC's by_industry endpoint doesn't exist, so we no longer
    // populate this. The briefing UI already prefers top_employers.
    top_industries: [],
    top_employers: employers.slice(0, 20).map((e) => ({
      employer: e.employer ?? "(unknown)",
      amount: Number(e.total ?? 0),
      count: Number(e.count ?? 0),
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

  const flags = [];
  if (relevant.pharma > 1000) flags.push(`pharma $${(relevant.pharma/1000).toFixed(0)}k`);
  if (relevant.alcohol > 1000) flags.push(`alcohol $${(relevant.alcohol/1000).toFixed(0)}k`);
  if (relevant.tobacco > 1000) flags.push(`tobacco $${(relevant.tobacco/1000).toFixed(0)}k`);
  console.log(`  ✓ $${(row.total_receipts/1000).toFixed(0)}k receipts | ${employers.length} top employers${flags.length ? " | " + flags.join(" | ") : ""}`);
  return "ok";
}

// ---- main ----
let legislators;
if (SPECIFIC) {
  const { data } = await sb.from("legislators").select("id, full_name, state, role, openfec_candidate_id").eq("id", SPECIFIC).single();
  legislators = data ? [data] : [];
} else {
  // Determine the candidate set
  let query = sb.from("legislators")
    .select("id, full_name, state, role, openfec_candidate_id")
    .in("role", ["us_senate", "us_house"])
    .eq("active", true);

  if (!ALL_FEDERAL) {
    query = query.limit(LIMIT);
  }

  const { data } = await query;
  let candidates = data ?? [];

  if (SKIP_CACHED) {
    // Drop legislators that already have a row in legislator_donors
    // (regardless of status). On --all-federal first run this stays
    // false so we get a single comprehensive sweep.
    const { data: existing } = await sb.from("legislator_donors")
      .select("legislator_id")
      .in("legislator_id", candidates.map((l) => l.id));
    const haveDonor = new Set((existing ?? []).map((r) => r.legislator_id));
    candidates = candidates.filter((l) => !haveDonor.has(l.id));
  }

  legislators = candidates;
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
