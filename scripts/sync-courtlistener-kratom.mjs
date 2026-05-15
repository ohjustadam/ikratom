/**
 * Sync kratom-mentioning court cases from CourtListener.
 *
 * CourtListener (https://www.courtlistener.com) is the Free Law
 * Project's free federal + state court aggregator. Two search types:
 *   - type=o (Opinions): published decided cases. ~200+ mentioning
 *     kratom (criminal cases interpreting state schedules etc.).
 *   - type=r (RECAP dockets): active filings, NOT yet decided. This
 *     is where the AKA-vs-state ban challenges live, AND where the
 *     industry-vs-retailer civil suits (Botanic Tonics suing former
 *     business partners, etc.) appear. 1600+ kratom-related dockets.
 *
 * Industry-party detection: opinions almost never have "American
 * Kratom Association" in the case name (those are mostly criminal
 * cases). Dockets do — they show direct industry litigation. The
 * INDUSTRY_PARTY_RE pattern catches both styles.
 *
 * What we capture per opinion:
 *   - case_name, docket_number, citation
 *   - court (name, id, jurisdiction) — court_id 'ohio' is state-
 *     supreme; 'tenn' / 'tenneca' / 'tn' are TN; we map to our
 *     2-letter state codes where possible
 *   - dateFiled
 *   - judge author + cite_count (rough authority signal)
 *   - syllabus (court's own summary)
 *   - We're idempotent on cl_cluster_id (UPSERT)
 *
 * Industry-party detection: we flag parties_industry=true when the
 * case_name matches industry-org patterns (American Kratom
 * Association, Global Kratom Coalition, Botanic Tonics, etc.).
 * These are the highest-value rows — direct AKA litigation against
 * a state ban tells advocates "this ban is being challenged."
 *
 * No auth required; free unlimited within reasonable use. Polite UA
 * + 1s delays between paginated requests.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-courtlistener-kratom.mjs
 *   node --env-file=.env.local scripts/sync-courtlistener-kratom.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-courtlistener-kratom.mjs --max-pages 5
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };
const flag = (n) => args.includes(n);

const DRY_RUN = flag("--dry-run");
const MAX_PAGES = parseInt(arg("--max-pages", "10"), 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const USER_AGENT = "iKratom-policy-monitor/1.0 (contact: ohjustadam@proton.me)";

// =============================================================
// court_id → 2-letter state mapping. CourtListener uses lowercase
// state names or abbreviations as court IDs. Not exhaustive — only
// the ones we know map cleanly. Federal courts (`ca1`-`ca11`, `dcd`,
// `scotus`, etc.) return NULL state.
// =============================================================
const COURT_ID_TO_STATE = {
  ala: "AL", alaska: "AK", ariz: "AZ", ark: "AR", calif: "CA",
  colo: "CO", conn: "CT", del: "DE", dc: "DC", fla: "FL",
  ga: "GA", haw: "HI", idaho: "ID", ill: "IL", ind: "IN",
  iowa: "IA", kan: "KS", ky: "KY", la: "LA", me: "ME",
  md: "MD", mass: "MA", mich: "MI", minn: "MN", miss: "MS",
  mo: "MO", mont: "MT", neb: "NE", nev: "NV", nh: "NH",
  nj: "NJ", nm: "NM", ny: "NY", nc: "NC", nd: "ND",
  ohio: "OH", okla: "OK", ore: "OR", pa: "PA", ri: "RI",
  sc: "SC", sd: "SD", tenn: "TN", tex: "TX", utah: "UT",
  vt: "VT", va: "VA", wash: "WA", wva: "WV", wis: "WI",
  wyo: "WY",
};

// =============================================================
// Patterns that flag the case as having a kratom-industry party.
// These are the highest-signal cases — AKA suing a state means
// active legal challenge to a ban.
// =============================================================
const INDUSTRY_PARTY_RE = new RegExp(
  [
    "american\\s+kratom",
    "kratom\\s+association",
    "global\\s+kratom",
    "botanic\\s+tonics",
    "kratom\\s+coalition",
    "7-?hope",
    "plant\\s+science\\s+and\\s+health",
    "feel\\s+free",
    "urban\\s+ice",
    "mit\\s*45",
  ].join("|"),
  "i",
);

// =============================================================
// State-law-challenged detection. When AKA sues, the case name often
// includes the state name as a defendant (e.g. "AKA v. Tennessee").
// We extract that as challenged_law context.
// =============================================================
function extractChallengedState(caseName) {
  if (!caseName) return null;
  // "AKA v. Tennessee", "Plaintiff v. State of TN", etc.
  const m = caseName.match(/v\.?\s+(?:State\s+of\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/);
  if (!m) return null;
  const name = m[1].trim();
  // Reverse-map state names
  const byName = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
    Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
    Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
    Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
    Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
    Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
    Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
    Wyoming: "WY",
  };
  return byName[name] ?? null;
}

// =============================================================
// Fetch one page of CourtListener search results.
// type='o' for opinions, type='r' for RECAP dockets.
// =============================================================
async function fetchPage(searchType, page) {
  const url = `https://www.courtlistener.com/api/rest/v4/search/?type=${searchType}&q=kratom&order_by=dateFiled+desc&page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`CourtListener ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// =============================================================
// Map CL result → our schema row
// caseKind = 'opinion' | 'docket' — the table partition the row
// belongs to.
// =============================================================
function toRow(r, caseKind = "opinion") {
  const courtId = (r.court_id ?? "").toLowerCase();
  const stateFromCourt = COURT_ID_TO_STATE[courtId] ?? null;
  const challengedState = extractChallengedState(r.caseName);
  const partiesIndustry = INDUSTRY_PARTY_RE.test(r.caseName ?? "") ||
                          INDUSTRY_PARTY_RE.test(r.caseNameFull ?? "");
  // Build the snippet — opinions[].snippet is the highlighted kratom-
  // mention context. Fall back to syllabus if no opinion-level snippet.
  const opSnippet = Array.isArray(r.opinions) && r.opinions[0]?.snippet;
  return {
    // For opinions, cluster_id is the canonical ID. For dockets,
    // cluster_id is null and docket_id is the canonical ID.
    cl_cluster_id: caseKind === "opinion" ? (r.cluster_id ?? null) : null,
    cl_docket_id: r.docket_id ?? null,
    cl_url: r.absolute_url ?? null,
    case_kind: caseKind,
    case_name: (r.caseName ?? "(no name)").slice(0, 500),
    case_name_full: r.caseNameFull ? r.caseNameFull.slice(0, 1000) : null,
    docket_number: r.docketNumber ? String(r.docketNumber).slice(0, 100) : null,
    citation: Array.isArray(r.citation) ? r.citation : [],
    court_name: r.court ?? null,
    court_id: courtId || null,
    state: stateFromCourt,
    jurisdiction: r.court_jurisdiction ?? null,
    date_filed: r.dateFiled ?? null,
    date_argued: r.dateArgued || null,
    date_reargued: r.dateReargued || null,
    judge: r.judge ?? null,
    status: r.status ?? null,
    cite_count: typeof r.citeCount === "number" ? r.citeCount : null,
    syllabus: r.syllabus ? r.syllabus.slice(0, 5000) : null,
    snippet: opSnippet ? String(opSnippet).slice(0, 1000) : null,
    parties_industry: partiesIndustry,
    challenged_law: challengedState ?? null,
    kratom_relevance: "pending",
    source: "courtlistener",
    raw_json: r,
    synced_at: new Date().toISOString(),
  };
}

// =============================================================
// Run one search type to completion (or max-pages cap)
// =============================================================
async function syncSearchType(searchType, label) {
  console.log(`\n=== ${label} (type=${searchType}) ===`);
  const rows = [];
  let totalCount = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data;
    try {
      data = await fetchPage(searchType, page);
    } catch (e) {
      console.error(`  Page ${page} fetch failed: ${e.message?.slice(0, 200)}`);
      break;
    }
    if (page === 1) totalCount = data.count ?? 0;
    const results = data.results ?? [];
    if (results.length === 0) break;
    console.log(`  Page ${page}: ${results.length} results`);
    for (const r of results) {
      rows.push(toRow(r, searchType === "o" ? "opinion" : "docket"));
    }
    if (!data.next) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`  Parsed ${rows.length} of ${totalCount} total ${label.toLowerCase()}`);
  return rows;
}

// =============================================================
// Dedupe within a batch by the appropriate unique key. CourtListener
// occasionally returns the same case across multiple pages of the
// same search type (paginate-shift behavior on date-tied results).
// Without dedup, the UPSERT errors on "ON CONFLICT cannot affect row
// a second time."
// =============================================================
function dedupeByKey(rows, keyField) {
  const seen = new Map();
  for (const r of rows) {
    const k = r[keyField];
    if (k == null) continue;            // null keys → can't dedupe via UNIQUE; keep all
    seen.set(k, r);                     // last-wins
  }
  // Preserve any null-key rows (rare; the migration constraint
  // allows multiple null cl_cluster_id rows).
  const nullKeyed = rows.filter(r => r[keyField] == null);
  return [...seen.values(), ...nullKeyed];
}

// =============================================================
// Main
// =============================================================
const t0 = Date.now();
console.log(`Syncing kratom cases from CourtListener${DRY_RUN ? " (DRY RUN)" : ""}…`);

const opinionRows = await syncSearchType("o", "Opinions");
const docketRows = await syncSearchType("r", "RECAP dockets");

const opinionRowsDedupe = dedupeByKey(opinionRows, "cl_cluster_id");
const docketRowsDedupe = dedupeByKey(docketRows, "cl_docket_id");

const allRows = [...opinionRowsDedupe, ...docketRowsDedupe];
const industryParty = allRows.filter(r => r.parties_industry);

console.log(`\n=== Summary ===`);
console.log(`  Opinions: ${opinionRowsDedupe.length} (after dedup from ${opinionRows.length})`);
console.log(`  Dockets:  ${docketRowsDedupe.length} (after dedup from ${docketRows.length})`);
console.log(`  Industry-party cases (high-signal): ${industryParty.length}`);
for (const r of industryParty.slice(0, 10)) {
  console.log(`    [${r.state ?? "FED"}] ${r.case_kind} · ${(r.date_filed ?? "").slice(0, 10)} · ${r.case_name?.slice(0, 80)}`);
}

if (DRY_RUN || allRows.length === 0) {
  console.log(`\n${DRY_RUN ? "DRY RUN — skipping insert." : "Nothing to write."}`);
  process.exit(0);
}

// Two-pass upsert: opinions UPSERT on cl_cluster_id, dockets UPSERT
// on cl_docket_id. Run separately because Supabase's upsert needs a
// single onConflict target per call.
const BATCH = 100;
let written = 0;

async function upsertChunk(table, rows, conflictTarget) {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error, data } = await sb
      .from(table)
      .upsert(chunk, { onConflict: conflictTarget })
      .select("id");
    if (error) {
      console.error(`  ${conflictTarget} batch ${i / BATCH} failed: ${error.message?.slice(0, 200)}`);
      continue;
    }
    total += data?.length ?? 0;
  }
  return total;
}

written += await upsertChunk("court_cases", opinionRowsDedupe, "cl_cluster_id");
written += await upsertChunk("court_cases", docketRowsDedupe, "cl_docket_id");

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${written} rows upserted.`);
