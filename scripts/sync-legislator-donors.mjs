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

// Normalize a name for matching: lowercase, strip prefixes/suffixes,
// drop punctuation, collapse whitespace. Used for last-name comparison
// against FEC results. Critical because FEC stores "SMITH, JOHN A." while
// our seed has "John Smith" — last-name match short-circuits most of
// these mismatches.
function normalizeName(n) {
  return String(n || "")
    .toLowerCase()
    .replace(/\b(sen|rep|hon|dr|mr|mrs|ms|jr|sr|ii|iii|iv)\.?\b/g, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNameOf(n) {
  // Handles "Smith, John A." (FEC format) AND "John A. Smith" (our format).
  // FEC's name field is comma-prefixed "LAST, FIRST"; detect that before
  // we normalize away the comma.
  const raw = String(n || "").trim();
  if (raw.includes(",")) {
    // already last-first — take everything before the first comma, then
    // strip prefixes/suffixes via normalize
    const beforeComma = raw.split(",")[0];
    return normalizeName(beforeComma).split(/\s+/).filter(Boolean).pop() ?? "";
  }
  const norm = normalizeName(raw);
  const parts = norm.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Normalize district to FEC's 2-char string format. Our DB has values
// like "1", "01", "AL" (at-large). FEC uses "01"–"99", "98" or "00"
// for at-large. We pad and strip leading zeros consistently.
function normalizeDistrict(d) {
  if (d == null) return null;
  const s = String(d).trim();
  if (/^\d+$/.test(s)) return s.padStart(2, "0");
  if (/^al$/i.test(s)) return "00"; // FEC treats at-large as "00" in some endpoints
  return s.toUpperCase();
}

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

// Resolve a candidate_id via multiple strategies (district-first, then
// name with nicknames + initials). FEC's name-search misses on legit
// candidates whenever (a) names diverge between our seed and FEC ("Alex"
// vs "Alejandro", "Kat" vs "Katherine"), (b) initial-only first names
// ("J. Correa"), or (c) common names with many candidates ("Mike Rogers").
//
// Strategy ordered by reliability:
//   1. cached candidate_id (skip if already resolved)
//   2. /candidates/ filtered by state + office + district (House only)
//      → narrows to ~1-2 incumbents per cycle, no name guess needed
//   3. /candidates/ filtered by state + office (Senate or House w/o district)
//      → at most 2 candidates for Senate seat, last-name disambiguates
//   4. /candidates/search/ with name (existing path) for edge cases
//
// All strategies prefer incumbent_challenge='I' when multiple results.
async function resolveCandidateId(leg, office) {
  if (leg.openfec_candidate_id) return { id: leg.openfec_candidate_id, reason: "cached" };

  const legLastName = lastNameOf(leg.full_name);
  // STRICT: require last-name match. Without this guard, the
  // district/state-office strategies can confidently mis-attribute donor
  // data when our seed district is stale (e.g. Ami Bera vs. Kevin Kiley
  // both in CA House). Better to leave a row not_found than to attribute
  // someone else's donor profile to this legislator — silent wrong
  // answers are worse than silent gaps.
  const tryStrategy = async (label, params) => {
    try {
      const data = await fec("/candidates/", params);
      const results = (data.results ?? []).filter((r) => r.candidate_id);
      if (results.length === 0) return null;
      const lnMatches = results.filter((r) => lastNameOf(r.name) === legLastName);
      if (lnMatches.length === 0) return null;
      const incumbent = lnMatches.find((r) => r.incumbent_challenge === "I");
      const chosen = incumbent ?? lnMatches[0];
      return { id: chosen.candidate_id, reason: label, total: results.length };
    } catch (e) {
      console.log(`  ⚠ ${label} failed: ${e.message?.slice(0, 80)}`);
      return null;
    }
  };

  // Strategy 2: state + office + district (House only — Senate doesn't have districts)
  if (office === "H") {
    const district = normalizeDistrict(leg.district);
    if (district) {
      const r = await tryStrategy("district", {
        state: leg.state, office, district,
        cycle: CYCLE, has_raised_funds: true, per_page: 20,
      });
      if (r) return r;
    }
  }

  // Strategy 3: state + office (no district)
  const r3 = await tryStrategy("state-office", {
    state: leg.state, office,
    cycle: CYCLE, has_raised_funds: true, per_page: 50,
  });
  if (r3) return r3;

  // Strategy 4: original name search (fallback for write-ins,
  // appointed-mid-cycle, or other edge cases the above can't catch).
  // Still requires last-name match.
  try {
    const data = await fec("/candidates/search/", {
      q: leg.full_name, state: leg.state, office, cycle: CYCLE,
    });
    const results = (data.results ?? []).filter((r) => r.candidate_id);
    if (results.length === 0) return null;
    const lnMatches = results.filter((r) => lastNameOf(r.name) === legLastName);
    if (lnMatches.length === 0) return null;
    const incumbent = lnMatches.find((r) => r.incumbent_challenge === "I");
    const chosen = incumbent ?? lnMatches[0];
    return { id: chosen.candidate_id, reason: "name-search", total: results.length };
  } catch (e) {
    console.log(`  ⚠ name-search failed: ${e.message?.slice(0, 80)}`);
  }

  return null;
}

async function syncOne(leg) {
  console.log(`\n=== ${leg.state} ${leg.full_name} | ${leg.role} ===`);

  const office = leg.role === "us_senate" ? "S" : leg.role === "us_house" ? "H" : null;
  if (!office) { console.log("  ⏭  not federal"); return "skip"; }

  const resolved = await resolveCandidateId(leg, office);
  if (!resolved) {
    console.log(`  ⏭  no OpenFEC match after district/state-office/name strategies`);
    await sb.from("legislator_donors").upsert({
      legislator_id: leg.id,
      cycle: CYCLE,
      resolved_status: "not_found",
      resolve_notes: `Exhausted district/state-office/name strategies for "${leg.full_name}" in ${leg.state} ${office} cycle ${CYCLE}`,
      synced_at: new Date().toISOString(),
    }, { onConflict: "legislator_id" });
    return "skip";
  }
  const candidateId = resolved.id;
  if (resolved.reason !== "cached") {
    console.log(`  ↳ resolved to ${candidateId} via ${resolved.reason}${resolved.total ? ` (${resolved.total} candidates checked)` : ""}`);
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
