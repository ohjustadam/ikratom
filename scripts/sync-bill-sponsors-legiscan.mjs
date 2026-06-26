#!/usr/bin/env node
/**
 * Back-fill bill_sponsors via LegiScan (the reliable, non-rate-limited path).
 *
 * The OpenStates sponsor sync (sync-bill-sponsors.mjs) is rate-limited to
 * ~100/min and trips a circuit-breaker after 6 consecutive 429s, so only
 * ~38% of bills ever got sponsors and bills like OK SB 891 showed no officials
 * at all. LegiScan's getBill returns a full sponsors[] array and we match each
 * sponsor to a legislator by `legiscan_people_id` (1,756 already linked by the
 * P1 vote-linkage backfill) — far more reliable than fuzzy name matching, and
 * LegiScan's monthly budget easily covers one getBill per tracked bill.
 *
 * For bills missing legiscan_bill_id we best-effort resolve it via getSearch
 * (exact state+number match only) and write it back so future runs are cheaper.
 *
 *   node --env-file=.env.local scripts/sync-bill-sponsors-legiscan.mjs            # dry-run
 *   node --env-file=.env.local scripts/sync-bill-sponsors-legiscan.mjs --apply
 *   node --env-file=.env.local scripts/sync-bill-sponsors-legiscan.mjs --state=OK --apply
 *   node --env-file=.env.local scripts/sync-bill-sponsors-legiscan.mjs --apply --no-resolve  # skip getSearch
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const RESOLVE = !args.includes("--no-resolve");
const stateArg = args.find((a) => a.startsWith("--state="))?.split("=")[1]?.toUpperCase() ?? null;
const LIMIT = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "10000", 10);

const KEY = process.env.LEGISCAN_API_KEY;
if (!KEY) { console.warn("LEGISCAN_API_KEY not set — skipping (exit 0)."); process.exit(0); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function legiscan(op, params, attempt = 0) {
  const u = new URL("https://api.legiscan.com/");
  u.searchParams.set("key", KEY);
  u.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
  let r;
  try {
    r = await fetch(u.toString(), { signal: AbortSignal.timeout(25_000) });
  } catch (e) {
    if (attempt < 2) { await sleep(2000 * (attempt + 1)); return legiscan(op, params, attempt + 1); }
    throw e;
  }
  if (!r.ok) {
    if ((r.status === 429 || r.status >= 500) && attempt < 2) { await sleep(3000 * (attempt + 1)); return legiscan(op, params, attempt + 1); }
    throw new Error(`LegiScan ${op} ${r.status}`);
  }
  const data = await r.json();
  if (data.status === "ERROR") throw new Error(`LegiScan ${op}: ${data.alert?.message ?? "unknown"}`);
  return data;
}

function normName(s) {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/\b(senator|representative|rep|sen|mr|mrs|ms|dr|hon|delegate|assemblyman|assemblywoman)\.?\b/gi, "")
    .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

// LegiScan sponsor_type_id: 1=Primary, 2=Co, 0=Sponsor, 3=Joint. Fall back to order.
function classifyOf(sp) {
  const t = Number(sp.sponsor_type_id);
  if (t === 1) return "primary";
  if (t === 2) return "cosponsor";
  return Number(sp.sponsor_order) === 1 ? "primary" : "cosponsor";
}

// --- legislator lookup indexes ---
async function loadPeopleMap() {
  const map = new Map(); // legiscan_people_id -> legislator id
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("legislators").select("id, legiscan_people_id").not("legiscan_people_id", "is", null).range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) map.set(Number(r.legiscan_people_id), r.id);
    if (data.length < 1000) break;
  }
  return map;
}
const stateNormCache = new Map();
async function nameIndexFor(state) {
  if (stateNormCache.has(state)) return stateNormCache.get(state);
  const byNorm = new Map();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("legislators").select("id, full_name").eq("state", state).eq("active", true).range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) { const n = normName(r.full_name); if (n && !byNorm.has(n)) byNorm.set(n, r.id); }
    if (data.length < 1000) break;
  }
  stateNormCache.set(state, byNorm);
  return byNorm;
}

// Bill numbers vary by source: we store "H.B. 8" / "SB 275"; LegiScan's
// masterlist uses zero-padded, period-less "HB0008" / "SB0275". Normalize both
// to prefix + unpadded-digits + optional-suffix so they match.
function normNum(s) {
  const t = String(s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const m = t.match(/^([A-Z]+)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : t;
}

// Per-state session roster from LegiScan: getSessionList → getMasterList per
// session (cached). getMasterList is the FULL session roster (every bill, not
// just LegiScan's kratom-tagged ones — the dataset heal misses bills LegiScan
// doesn't tag kratom), so we can resolve any bill we know by number.
const masterlistCache = new Map();
async function masterlistFor(state) {
  if (masterlistCache.has(state)) return masterlistCache.get(state);
  const out = [];
  try {
    const sl = await legiscan("getSessionList", { state });
    const sessions = (sl.sessions ?? []).filter((s) => (s.year_end ?? 0) >= 2019).sort((a, b) => (b.year_end ?? 0) - (a.year_end ?? 0));
    for (const ses of sessions) {
      try {
        const ml = await legiscan("getMasterList", { id: ses.session_id });
        const m = ml.masterlist ?? {};
        const map = new Map();
        for (const k of Object.keys(m)) {
          if (k === "session") continue;
          const b = m[k];
          if (b?.number && b?.bill_id) { const n = normNum(b.number); if (!map.has(n)) map.set(n, Number(b.bill_id)); }
        }
        out.push({ session_id: ses.session_id, year_start: ses.year_start ?? 0, year_end: ses.year_end ?? 0, map });
      } catch { /* skip a bad session */ }
      await sleep(150);
    }
  } catch { /* state has no sessions / API hiccup */ }
  masterlistCache.set(state, out);
  return out;
}

// Resolve legiscan_bill_id for a bill we know by (state, number, year) — exact
// number match within the LegiScan session covering the bill's year. A given
// number is unique within a session, so state+number+year pins exactly one bill
// (disambiguates the same number reused across bienniums). Never guesses.
async function resolveLegiscanId(bill) {
  const want = normNum(bill.bill_number);
  if (!want) return null;
  const year = parseInt(String(bill.last_action_at ?? bill.session_id ?? "").slice(0, 4), 10);
  const sessions = await masterlistFor(bill.state);
  if (!sessions.length) return null;
  let candidates = Number.isFinite(year)
    ? sessions.filter((s) => s.year_start <= year && year <= s.year_end)
    : sessions;
  if (!candidates.length) candidates = sessions;
  const hits = candidates.filter((s) => s.map.has(want));
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0].map.get(want);
  // Multiple sessions cover the year and share the number. If we don't know the
  // year, refuse to guess. Else prefer the session ending that year, then newest.
  if (!Number.isFinite(year)) return null;
  const exact = hits.find((s) => s.year_end === year);
  return (exact ?? hits[0]).map.get(want);
}

async function processBill(bill, peopleMap) {
  let lsId = bill.legiscan_bill_id;
  let resolved = false;
  if (!lsId && RESOLVE) {
    lsId = await resolveLegiscanId(bill);
    if (lsId) resolved = true;
  }
  if (!lsId) return { status: "no-legiscan-id" };

  let detail;
  try {
    const data = await legiscan("getBill", { id: lsId });
    detail = data.bill;
  } catch (e) {
    return { status: "fetch-error", error: e.message };
  }
  // Defense: if we RESOLVED this id (vs it being stored), confirm the fetched
  // bill's number + state actually match ours before trusting its sponsors — a
  // mis-resolution must never attach a wrong bill's officials.
  if (resolved && detail && (normNum(detail.bill_number) !== normNum(bill.bill_number) || (detail.state && detail.state !== bill.state))) {
    return { status: "id-mismatch" };
  }
  const sponsors = detail?.sponsors ?? [];
  if (sponsors.length === 0) return { status: "no-sponsors", resolvedId: resolved ? lsId : null };

  const byNorm = await nameIndexFor(bill.state);
  const rows = [];
  const seen = new Set();
  let matched = 0, unmatched = 0;
  for (const sp of sponsors) {
    const name = sp.name || [sp.first_name, sp.last_name].filter(Boolean).join(" ");
    if (!name) continue;
    const classification = classifyOf(sp);
    const key = `${name}|${classification}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let legId = null;
    const pid = Number(sp.people_id);
    if (pid && peopleMap.has(pid)) { legId = peopleMap.get(pid); matched++; }
    else { const cand = byNorm.get(normName(name)); if (cand) { legId = cand; matched++; } else unmatched++; }
    rows.push({
      bill_id: bill.id,
      legislator_id: legId,
      name: name.slice(0, 200),
      classification,
      party: (sp.party ?? null)?.slice?.(0, 40) ?? sp.party ?? null,
      district: (sp.district ?? null)?.toString?.().slice(0, 40) ?? null,
    });
  }

  if (APPLY && rows.length) {
    if (resolved) await sb.from("bills").update({ legiscan_bill_id: lsId }).eq("id", bill.id);
    await sb.from("bill_sponsors").delete().eq("bill_id", bill.id);
    const { error } = await sb.from("bill_sponsors").insert(rows);
    if (error) return { status: "db-error", error: error.message };
  }
  return { status: "ok", total: rows.length, matched, unmatched, resolvedId: resolved ? lsId : null };
}

// ---------- main ----------
let q = sb.from("bills").select("id, state, bill_number, legiscan_bill_id, last_action_at, session_id").order("state", { ascending: true }).limit(LIMIT);
if (stateArg) q = q.eq("state", stateArg);
// --missing-only: just the bills lacking a legiscan_bill_id (the resolve-the-gap
// pass), so we don't re-fetch+rewrite sponsors for the ones already synced.
if (args.includes("--missing-only")) q = q.is("legiscan_bill_id", null);
const { data: bills, error } = await q;
if (error) { console.error(error.message); process.exit(1); }

console.log(`\n=== sync-bill-sponsors-legiscan ${APPLY ? "(APPLY)" : "(dry-run)"}${stateArg ? ` state=${stateArg}` : ""} ===`);
console.log(`${bills.length} bills · resolve-missing-ids=${RESOLVE}\n`);

const peopleMap = await loadPeopleMap();
console.log(`legislator people-id map: ${peopleMap.size} entries\n`);

const t0 = Date.now();
let okCount = 0, totalSponsors = 0, totalMatched = 0, resolvedCount = 0;
const tally = {};
for (const b of bills) {
  const r = await processBill(b, peopleMap);
  tally[r.status] = (tally[r.status] || 0) + 1;
  if (r.status === "ok") {
    okCount++; totalSponsors += r.total; totalMatched += r.matched;
    if (r.resolvedId) resolvedCount++;
    console.log(`  ${b.state} ${b.bill_number}: ✓ ${r.total} sponsors (${r.matched} matched, ${r.unmatched} unmatched)${r.resolvedId ? ` [resolved id ${r.resolvedId}]` : ""}`);
  } else if (r.status === "fetch-error" || r.status === "db-error") {
    console.log(`  ${b.state} ${b.bill_number}: ${r.status} — ${r.error?.slice(0, 70)}`);
  }
  await sleep(220);
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\nDone in ${mins} min — ${okCount}/${bills.length} bills got sponsors, ${totalSponsors} rows (${totalMatched} matched to legislators), ${resolvedCount} ids resolved`);
console.log("status tally:", JSON.stringify(tally));

if (APPLY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "sync_bill_sponsors_legiscan",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: okCount > 0 ? "success" : "empty",
      rows_added: totalSponsors,
      notes: `${okCount}/${bills.length} bills · ${totalMatched}/${totalSponsors} matched · ${resolvedCount} ids resolved`,
    });
  } catch { /* best-effort */ }
} else {
  console.log("\n(dry-run — re-run with --apply to write)");
}
process.exit(0);
