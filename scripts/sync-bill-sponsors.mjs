#!/usr/bin/env node
/**
 * Back-fill bill_sponsors via OpenStates.
 *
 * The sync-bills.mjs script pulls bills but throws away the
 * sponsorships array. This script catches them up by re-fetching
 * each active bill's detail with `include=sponsorships` and writing
 * primary + cosponsor rows.
 *
 * Matches each sponsor to a legislator row by openstates_id first
 * (most reliable), then by fuzzy name match within the state's
 * legislators. Sponsors that can't match get sponsor_name_raw set
 * so the data isn't lost — admin can manually link later.
 *
 * Run:
 *   node --env-file=.env.local scripts/sync-bill-sponsors.mjs --state NY
 *   node --env-file=.env.local scripts/sync-bill-sponsors.mjs --state NY --limit 10
 *   node --env-file=.env.local scripts/sync-bill-sponsors.mjs --all
 *
 * Polite: 1.2s delay per API call (OpenStates rate limits 100/min).
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const STATE = arg("--state");
const ALL = args.includes("--all");
const LIMIT = parseInt(arg("--limit") ?? "200");
const DRY_RUN = args.includes("--dry-run");
// Wall-clock budget. The GHA job times out at 30 min; OpenStates throttling can
// make each bill burn its full retry budget, so the loop can grind past 30 min
// and get HARD-CANCELLED mid-loop — which skips the scraper_runs telemetry write
// below and makes this source invisible to check-cron-staleness (it was
// classified "never observed" and never paged). Stop cleanly a few minutes
// early so the telemetry insert ALWAYS runs. Override with --max-minutes.
const MAX_MINUTES = parseInt(arg("--max-minutes") ?? "25");
const MAX_RUN_MS = MAX_MINUTES * 60_000;

if (!STATE && !ALL) {
  console.error("Usage: --state <2-letter>  OR  --all  (optional --limit N, --dry-run)");
  process.exit(1);
}

const apiKey = process.env.OPENSTATES_API_KEY;
if (!apiKey) {
  // No key here → skip gracefully (exit 0) so the cron job stays green and
  // the needs: cascade keeps moving. check-cron-staleness catches a prolonged
  // absence (no scraper_runs telemetry gets written).
  console.warn("OPENSTATES_API_KEY not set — skipping sponsor sync (exit 0).");
  process.exit(0);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBillDetail(state, billNumber, attempt = 0) {
  // We don't store openstates UUIDs, so search by jurisdiction + identifier.
  // The first result is the bill in the current session (sorted by updated_desc).
  const url = new URL("https://v3.openstates.org/bills");
  url.searchParams.set("jurisdiction", state.toLowerCase());
  url.searchParams.set("identifier", billNumber.replace(/\s+/g, "").toUpperCase());
  url.searchParams.set("include", "sponsorships");
  url.searchParams.set("per_page", "5");
  url.searchParams.set("sort", "updated_desc");
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429 && attempt < 3) {
    const ra = parseInt(res.headers.get("retry-after") ?? "", 10);
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 90_000) : (attempt + 1) * 20_000;
    console.log(`    rate limited — waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return fetchBillDetail(state, billNumber, attempt + 1);
  }
  if (!res.ok) throw new Error(`OpenStates ${res.status}`);
  const data = await res.json();
  return data?.results?.[0] ?? null;
}

// Normalize names for fuzzy match: lowercase, strip titles, collapse spaces
function normName(s) {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/\b(senator|representative|rep|sen|mr|mrs|ms|dr|hon)\.?\b/gi, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadStateLegislators(state) {
  let all = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await sb.from("legislators")
      .select("id, full_name, openstates_id, party")
      .eq("state", state)
      .eq("active", true)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
  }
  const byOpenstates = new Map();
  const byNorm = new Map();
  for (const r of all) {
    if (r.openstates_id) byOpenstates.set(r.openstates_id, r);
    const n = normName(r.full_name);
    if (n) byNorm.set(n, r);
  }
  return { all, byOpenstates, byNorm };
}

async function processBill(bill, legIndex) {
  const tag = `${bill.state} ${bill.bill_number}`;
  let detail;
  try {
    detail = await fetchBillDetail(bill.state, bill.bill_number);
  } catch (e) {
    return { bill: tag, status: "fetch-error", error: e.message };
  }
  if (!detail) return { bill: tag, status: "not-found" };
  const sponsorships = detail?.sponsorships ?? [];
  if (sponsorships.length === 0) {
    return { bill: tag, status: "no-sponsors", count: 0 };
  }

  // Wipe existing rows for this bill (idempotent reseed)
  if (!DRY_RUN) {
    await sb.from("bill_sponsors").delete().eq("bill_id", bill.id);
  }

  // Schema (from migration 0032):
  //   name (text NOT NULL), classification (text), party, district
  // Uses the existing columns rather than the ones the failed 0112
  // CREATE TABLE IF NOT EXISTS tried to add.
  let matched = 0, unmatched = 0;
  const rows = [];
  const seen = new Set();
  for (const sp of sponsorships) {
    const osid = sp.person?.id ?? null;
    const rawName = sp.name ?? sp.person?.name ?? null;
    if (!rawName) continue;
    const classification = (sp.primary === true || /primary/i.test(sp.classification ?? ""))
      ? "primary" : "cosponsor";
    // Dedup at script level (unique constraint is on (bill_id, name, classification))
    const dedupeKey = `${rawName}|${classification}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    let legId = null;
    if (osid && legIndex.byOpenstates.has(osid)) {
      legId = legIndex.byOpenstates.get(osid).id;
      matched++;
    } else if (rawName) {
      const cand = legIndex.byNorm.get(normName(rawName));
      if (cand) {
        legId = cand.id;
        matched++;
      } else {
        unmatched++;
      }
    }
    rows.push({
      bill_id: bill.id,
      legislator_id: legId,
      name: rawName,
      classification,
      party: sp.person?.party ?? null,
      district: sp.person?.current_role?.district ?? null,
    });
  }
  if (!DRY_RUN && rows.length > 0) {
    const { error } = await sb.from("bill_sponsors").insert(rows);
    if (error) return { bill: tag, status: "db-error", error: error.message };
  }
  return { bill: tag, status: "ok", total: rows.length, matched, unmatched };
}

// ---------- main ----------
const targets = STATE ? [STATE.toUpperCase()] : null;
let query = sb.from("bills")
  .select("id, state, bill_number, source_url")
  .eq("active", true)
  .in("kratom_relevance", ["anti", "pro", "neutral"])
  .order("last_action_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (targets) query = query.in("state", targets);
const { data: bills, error: billsErr } = await query;
if (billsErr) { console.error(billsErr.message); process.exit(1); }
if (!bills || bills.length === 0) { console.log("No bills to process."); process.exit(0); }

// Cache legislator lookups per state
const legCache = new Map();
async function legFor(state) {
  if (!legCache.has(state)) legCache.set(state, await loadStateLegislators(state));
  return legCache.get(state);
}

console.log(`Processing ${bills.length} bills${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
const t0 = Date.now();
const results = [];
// Circuit breaker: when OpenStates hard-rate-limits us, every bill burns the
// full retry budget (~3 min each) and the job grinds into its 30-min timeout
// (root cause of the 2026-06-05 failure). After a run of consecutive 429s,
// bail cleanly with partial progress — the daily re-run continues. Structural
// fix: a LegiScan key offloads bill data from OpenStates (see V2_KICKOFF).
let consecutive429 = 0;
let stoppedEarly = false;
const BREAK_AFTER = 6;
for (const b of bills) {
  // Wall-clock guard: bail before the CI hard-timeout so telemetry is written.
  if (Date.now() - t0 > MAX_RUN_MS) {
    stoppedEarly = true;
    console.log(`\n⏱ Reached ${MAX_MINUTES}-min wall-clock budget — stopping early (partial run) so telemetry is recorded before the CI timeout. Daily re-run continues where this left off.`);
    break;
  }
  const legIndex = await legFor(b.state);
  process.stdout.write(`  ${b.state} ${b.bill_number} `);
  const r = await processBill(b, legIndex);
  results.push(r);
  if (r.status === "ok") {
    consecutive429 = 0;
    console.log(`✓ ${r.total} sponsors (${r.matched} matched, ${r.unmatched} unmatched)`);
  } else {
    if (r.status === "fetch-error" && /429/.test(r.error ?? "")) consecutive429++;
    console.log(`${r.status}` + (r.error ? `: ${r.error.slice(0, 60)}` : ""));
  }
  if (consecutive429 >= BREAK_AFTER) {
    stoppedEarly = true;
    console.log(`\n⚠ OpenStates rate-limited ${BREAK_AFTER}x in a row — stopping early (partial run). Daily re-run will continue.`);
    break;
  }
  await sleep(1200);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
const ok = results.filter(r => r.status === "ok").length;
const totalSponsors = results.reduce((s, r) => s + (r.total ?? 0), 0);
const totalMatched = results.reduce((s, r) => s + (r.matched ?? 0), 0);
console.log(`\nDone in ${elapsed} min — ${ok}/${results.length} bills processed, ${totalSponsors} sponsors total (${totalMatched} matched to legislators)`);

try {
  await sb.from("scraper_runs").insert({
    source: "sync_bill_sponsors",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: stoppedEarly ? "partial" : (ok > 0 ? "success" : "empty"),
    rows_added: totalSponsors,
    notes: `${ok}/${results.length} bills · ${totalMatched}/${totalSponsors} sponsors matched${stoppedEarly ? " · stopped early (budget/rate-limit)" : ""}`,
  });
} catch { /* best-effort */ }
process.exit(0);
