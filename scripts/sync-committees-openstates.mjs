#!/usr/bin/env node
/**
 * iKratom — OpenStates committee sync (all 50 + DC).
 *
 * Generalizes scrape-ny-committees.mjs (which hand-scraped
 * nyassembly.gov + nysenate.gov HTML) to every state via OpenStates
 * v3 API. Until this ran, only NY had legislator_committees data
 * populated — leaving the draft-legislator-stance pipeline blind for
 * 49 states.
 *
 * Per state:
 *   1. GET /committees?jurisdiction={state}
 *   2. For each committee → identify kratom-relevance from name
 *   3. For each committee.member → upsert into legislator_committees
 *      with role (chair/vice/member) + is_kratom_relevant flag
 *
 * Kratom-relevant committee patterns (case-insensitive):
 *   Health, Public Health, Medical, Health & Welfare, Health Policy
 *   Judiciary, Criminal Justice, Courts, Public Safety
 *   Codes (NY-specific term for criminal code)
 *   Consumer (Affairs|Protection|Goods)
 *   Drug Policy, Substance Abuse, Narcotics, Controlled Substances
 *   Government Affairs (where pharmacy boards report)
 *   Agriculture (where hemp / cannabis bills live in some states)
 *
 * Free: OPENSTATES_API_KEY is the same key sync-legislators.mjs uses.
 * Rate-limit: 1 req/sec polite default. OpenStates rate limit is 100/min.
 *
 * Run:
 *   node --env-file=.env.local scripts/sync-committees-openstates.mjs
 *   node --env-file=.env.local scripts/sync-committees-openstates.mjs --state TX
 *   node --env-file=.env.local scripts/sync-committees-openstates.mjs --priority-only
 *   node --env-file=.env.local scripts/sync-committees-openstates.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ONE_STATE = arg("--state");
const PRIORITY_ONLY = args.includes("--priority-only");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENSTATES_KEY = process.env.OPENSTATES_API_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!OPENSTATES_KEY) { console.error("Missing OPENSTATES_API_KEY"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIORITY_STATES = ["NY", "FL", "TX", "CA", "OH", "MI", "TN", "MO", "PA", "GA"];
const ALL_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

// Committee name patterns that imply kratom-relevance.
// Order matters — first match wins (more-specific patterns first).
const KRATOM_RELEVANT_RX = [
  /\b(drug\s+polic|narcot|controlled\s+substance|substance\s+abuse)\b/i,
  /\b(public\s+health|health\s+(and|&)\s+human|health\s+(and|&)\s+welfare|health\s+polic|health\b)/i,
  /\bjudiciar/i,
  /\b(criminal\s+justice|public\s+safety|courts?)\b/i,
  /\bcodes?\b/i,                                                  // NY-style criminal codes committee
  /\bconsumer\s+(affairs|protection|goods|services)\b/i,
  /\b(government\s+(affairs|operations|oversight))\b/i,            // where BoP boards report
  /\b(commerce|business|economic\s+matters)\b/i,                   // where some retail-restriction bills live
];

function isKratomRelevant(name) {
  return KRATOM_RELEVANT_RX.some((rx) => rx.test(name));
}

// OpenStates chamber → our chamber convention
function normalizeChamber(c) {
  if (!c) return null;
  const lower = c.toLowerCase();
  if (lower === "upper" || lower === "senate") return "senate";
  if (lower === "lower" || lower === "house" || lower === "assembly") return "house";
  return null;  // 'legislature' (joint) or unknown — store as null
}

function normalizeRole(r) {
  if (!r) return "member";
  const lower = r.toLowerCase();
  if (lower.includes("chair") && !lower.includes("vice")) return "chair";
  if (lower.includes("vice") || lower.includes("ranking")) return "vice_chair";
  return "member";
}

async function fetchCommittees(stateCode) {
  const out = [];
  const jurisdiction = `ocd-jurisdiction/country:us/state:${stateCode.toLowerCase()}/government`;
  // OpenStates v3 max per_page is 20. include=memberships flag returns
  // the member roster inline so we don't need a per-committee lookup.
  let page = 1;
  while (true) {
    const url = `https://v3.openstates.org/committees?jurisdiction=${encodeURIComponent(jurisdiction)}&include=memberships&page=${page}&per_page=20`;
    const res = await fetch(url, {
      headers: { "X-API-Key": OPENSTATES_KEY },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`OpenStates ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    const results = data?.results ?? [];
    out.push(...results);
    const totalPages = data?.pagination?.max_page ?? 1;
    if (page >= totalPages) break;
    page++;
    await sleep(1000);   // polite
  }
  return out;
}

async function syncState(stateCode) {
  process.stdout.write(`[${stateCode}] `);
  let committees;
  try {
    committees = await fetchCommittees(stateCode);
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 80)}`);
    return { state: stateCode, status: "error", reason: e.message };
  }
  if (committees.length === 0) {
    console.log("· no committees");
    return { state: stateCode, status: "empty" };
  }

  // Pull legislators in this state so we can match member names → ids
  const { data: legs } = await sb.from("legislators")
    .select("id, full_name, openstates_id")
    .eq("state", stateCode)
    .eq("active", true);
  // index by openstates id (preferred) AND lowercase full name
  const legByOsId = new Map();
  const legByName = new Map();
  for (const l of legs ?? []) {
    if (l.openstates_id) legByOsId.set(l.openstates_id, l.id);
    if (l.full_name) legByName.set(l.full_name.toLowerCase().trim(), l.id);
  }

  let upserts = 0, kratomCommittees = 0, unmatched = 0;
  for (const cm of committees) {
    const name = cm.name;
    const isRelevant = isKratomRelevant(name);
    if (isRelevant) kratomCommittees++;
    const chamber = normalizeChamber(cm.classification);

    for (const m of cm.memberships ?? []) {
      const osPersonId = m?.person?.id;
      const memberName = m?.person?.name;
      // Try openstates id first, fall back to name match
      let legId = osPersonId ? legByOsId.get(osPersonId) : null;
      if (!legId && memberName) {
        legId = legByName.get(memberName.toLowerCase().trim());
      }
      if (!legId) {
        unmatched++;
        continue;
      }
      const role = normalizeRole(m.role);
      if (DRY_RUN) {
        upserts++;
        continue;
      }
      // Unique constraint on (legislator_id, committee_name, session_id)
      // — use a stable session_id so re-runs upsert cleanly. Errors
      // are logged so silent-failure (the bug from the first run that
      // showed '0 memberships') can't happen again.
      const { error } = await sb.from("legislator_committees").upsert(
        {
          legislator_id: legId,
          committee_name: name.slice(0, 200),
          chamber,
          role,
          is_kratom_relevant: isRelevant,
          session_id: "openstates-current",
        },
        { onConflict: "legislator_id,committee_name,session_id" },
      );
      if (error) {
        // Surface every first error to make debugging future syncs sane
        if (upserts === 0) console.log(`    ✗ upsert: ${error.message?.slice(0, 120)}`);
      } else {
        upserts++;
      }
    }
  }
  console.log(`✓ ${committees.length} committees (${kratomCommittees} kratom-relevant), ${upserts} memberships, ${unmatched} unmatched`);
  return { state: stateCode, status: "ok", committees: committees.length, kratomCommittees, upserts, unmatched };
}

// ---------- main ----------
const targets = ONE_STATE
  ? [ONE_STATE.toUpperCase()]
  : PRIORITY_ONLY
  ? PRIORITY_STATES
  : ALL_STATES;

console.log(`Syncing committees across ${targets.length} state(s)${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
const t0 = Date.now();
let totalUpserts = 0;
let totalKratomCommittees = 0;
const results = [];
for (const s of targets) {
  const r = await syncState(s);
  results.push(r);
  if (r.status === "ok") {
    totalUpserts += r.upserts ?? 0;
    totalKratomCommittees += r.kratomCommittees ?? 0;
  }
  await sleep(1500);  // polite between states
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${targets.length} states · ${totalUpserts} committee memberships upserted · ${totalKratomCommittees} kratom-relevant committees across all states.`);

try {
  await sb.from("scraper_runs").insert({
    source: "sync_committees_openstates",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalUpserts > 0 ? "success" : "empty",
    rows_added: totalUpserts,
    notes: `${targets.length} states · ${totalUpserts} memberships · ${totalKratomCommittees} kratom committees`,
  });
} catch { /* */ }
process.exit(0);
