/**
 * Name and link every roll-call vote we hold.
 *
 * LegiScan's getRollCall lists each vote as a bare people_id, so a vote only
 * reads as a person once that id is tied to a legislator. Until 2026-11-16 the
 * sync tied only ids already on a legislators row, and stored no name at all,
 * so about half of all votes showed as blank. This script:
 *   1. reads each state's sessions from LegiScan (getSessionList, then
 *      getSessionPeople, newest first) until every people_id is named;
 *   2. writes the name on every vote row, linked or not;
 *   3. ties a people_id to a legislator only by NAME (scripts/lib/legiscan-people.mjs),
 *      unique and collision-free, and records it on the legislators row;
 *   4. ties OpenStates votes (stored by voter name) the same way;
 *   5. reports existing links whose LegiScan name disagrees with ours.
 *
 * Dry run by default. `--apply` writes. Additive: it fills empty names and
 * null links, and never moves a vote that is already linked.
 *
 *   node --env-file=.env.local scripts/backfill-legiscan-people.mjs
 *   node --env-file=.env.local scripts/backfill-legiscan-people.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { createLegiscanClient, legiscanCallsThisMonth, remainingFor } from "./lib/legiscan-budget.mjs";
import {
  matchPerson, matchVoterName, collisionFree, personName, chamberOf, sameName,
} from "./lib/legiscan-people.mjs";

const APPLY = process.argv.includes("--apply");
const MAX_SESSIONS_PER_STATE = 12;
const SOURCE = "backfill_legiscan_people";
const KEY = process.env.LEGISCAN_API_KEY;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!KEY) { console.error("no LEGISCAN_API_KEY"); process.exit(1); }
const started = new Date();

async function pageAll(table, cols, tweak) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).order("id").range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const used = await legiscanCallsThisMonth(sb);
const client = createLegiscanClient(KEY, { maxCalls: remainingFor(used, "nonessential") });

const bills = await pageAll("bills", "id,state");
const billState = new Map(bills.map((b) => [b.id, b.state]));
const votes = await pageAll("bill_votes", "id,bill_id,chamber,vote_date");
const voteMeta = new Map(votes.map((v) => [v.id, { state: billState.get(v.bill_id), chamber: chamberOf(v.chamber), date: v.vote_date }]));
const members = await pageAll("bill_vote_members", "id,bill_vote_id,legiscan_people_id,legislator_id,legislator_name");

// ── LegiScan people: which state each id voted in ──
const pidStates = new Map();
for (const m of members) {
  if (m.legiscan_people_id == null) continue;
  const st = voteMeta.get(m.bill_vote_id)?.state;
  if (!st) continue;
  if (!pidStates.has(m.legiscan_people_id)) pidStates.set(m.legiscan_people_id, new Map());
  const s = pidStates.get(m.legiscan_people_id);
  s.set(st, (s.get(st) ?? 0) + 1);
}
const needByState = new Map();
for (const [pid, states] of pidStates) {
  const st = top(states);
  if (!needByState.has(st)) needByState.set(st, new Set());
  needByState.get(st).add(pid);
}

const people = new Map(); // people_id -> getSessionPeople entry
let budgetStop = false;
for (const [st, need] of needByState) {
  try {
    const sl = await client.call("getSessionList", { state: st });
    const sessions = (sl.sessions ?? []).slice().sort((a, b) => (b.year_end ?? 0) - (a.year_end ?? 0));
    for (const s of sessions.slice(0, MAX_SESSIONS_PER_STATE)) {
      if ([...need].every((pid) => people.has(pid))) break;
      const sp = await client.call("getSessionPeople", { id: s.session_id });
      for (const p of sp.sessionpeople?.people ?? []) if (!people.has(p.people_id)) people.set(p.people_id, { ...p, state: st });
    }
  } catch (e) {
    console.log(`  ⚠ ${st}: ${e.message.slice(0, 120)}`);
    if (client.exhausted) { budgetStop = true; break; }
  }
}
console.log(`LegiScan people: ${pidStates.size} ids in votes, ${people.size} named (${client.calls} calls)`);

// ── Our legislators, by state ──
const states = [...new Set([...needByState.keys(), ...votes.map((v) => billState.get(v.bill_id))].filter(Boolean))];
const legs = await pageAll("legislators", "id,full_name,district,role,state,legiscan_people_id",
  (q) => q.in("role", ["state_house", "state_senate"]).in("state", states));
const legsByState = new Map();
for (const l of legs) legsByState.set(l.state, [...(legsByState.get(l.state) ?? []), l]);
const legById = new Map(legs.map((l) => [l.id, l]));

// ── Wrong links: a people_id on a legislator whose name it doesn't share ──
// The first backfill fell back to the district alone, which handed a departed
// member's votes to whoever holds the seat now. Those links come off first.
const wrong = [];
for (const l of legs) {
  const p = l.legiscan_people_id != null ? people.get(l.legiscan_people_id) : null;
  if (p && !sameName(p, l.full_name)) {
    wrong.push({ legId: l.id, pid: l.legiscan_people_id, line: `${l.state} pid ${l.legiscan_people_id} "${personName(p)}" was linked to "${l.full_name}"` });
    l.legiscan_people_id = null;
  }
}

// ── Plan: LegiScan ids ──
const pairs = [];
for (const [pid, p] of people) {
  if (!pidStates.has(pid)) continue;
  const legId = matchPerson(p, legsByState.get(p.state) ?? []);
  if (legId) pairs.push({ pid, legId, name: personName(p) });
}
const links = collisionFree(pairs);
const newLinks = links.filter((x) => legById.get(x.legId)?.legiscan_people_id == null);

const rowsByPid = new Map();
for (const m of members) if (m.legiscan_people_id != null) rowsByPid.set(m.legiscan_people_id, [...(rowsByPid.get(m.legiscan_people_id) ?? []), m]);
const linkByPid = new Map(links.map((x) => [x.pid, x.legId]));
let rowsLinked = 0, rowsNamed = 0;
for (const [pid, rows] of rowsByPid) {
  const legId = linkByPid.get(pid);
  for (const r of rows) {
    if (!r.legislator_id && legId) rowsLinked++;
    if (!r.legislator_name && people.has(pid)) rowsNamed++;
  }
}

// ── Plan: OpenStates votes (by name) ──
const osLinks = new Map(); // legId -> member row ids
for (const m of members) {
  if (m.legiscan_people_id != null || m.legislator_id || !m.legislator_name) continue;
  const meta = voteMeta.get(m.bill_vote_id);
  if (!meta?.state) continue;
  const legId = matchVoterName(m.legislator_name, legsByState.get(meta.state) ?? [], { chamber: meta.chamber, voteDate: meta.date });
  if (legId) osLinks.set(legId, [...(osLinks.get(legId) ?? []), m.id]);
}
const osRows = [...osLinks.values()].reduce((a, ids) => a + ids.length, 0);

console.log(`Plan: ${links.length} people tied to a legislator (${newLinks.length} new, ${pairs.length - links.length} dropped as collisions)`);
console.log(`      ${rowsLinked} LegiScan vote rows to link, ${rowsNamed} to name, ${osRows} OpenStates vote rows to link`);
console.log(`      ${wrong.length} wrong links to undo${wrong.length ? ":" : ""}`);
for (const w of wrong.slice(0, 25)) console.log(`        ${w.line}`);

if (!APPLY) {
  const pick = (a, n) => a.filter((_, i) => i % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  console.log("Sample new links (LegiScan name -> our legislator):");
  for (const x of pick(newLinks, 10)) console.log(`   ${x.name} -> ${legById.get(x.legId)?.full_name} (${legById.get(x.legId)?.state} ${legById.get(x.legId)?.role})`);
  const osSample = [];
  for (const [legId, ids] of osLinks) osSample.push(`${members.find((m) => m.id === ids[0])?.legislator_name} -> ${legById.get(legId)?.full_name} (${legById.get(legId)?.state})`);
  console.log("Sample OpenStates links:");
  for (const s of pick(osSample, 10)) console.log(`   ${s}`);
  console.log("=== DRY RUN: no writes (add --apply) ===");
  await record("empty", `dry run · ${rowsLinked} to link, ${rowsNamed} to name, ${osRows} OS to link · legiscan_calls=${client.calls}`);
  process.exit(0);
}

// What this run changes, so it can be undone row for row.
const rbIdx = process.argv.indexOf("--rollback-file");
if (rbIdx > 0) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[rbIdx + 1], JSON.stringify({
    at: started.toISOString(), newLinks, wrong, links,
    openstates: [...osLinks].map(([legId, ids]) => ({ legId, ids })),
  }));
}

let errs = 0;
const note = (r) => { if (r.error && ++errs <= 5) console.log(`  ⚠ ${r.error.message}`); };
for (const w of wrong) {
  note(await sb.from("legislators").update({ legiscan_people_id: null }).eq("id", w.legId).eq("legiscan_people_id", w.pid));
  note(await sb.from("bill_vote_members").update({ legislator_id: null }).eq("legiscan_people_id", w.pid).eq("legislator_id", w.legId));
}
for (const b of chunk(newLinks, 25)) {
  (await Promise.all(b.map((x) => sb.from("legislators").update({ legiscan_people_id: x.pid }).eq("id", x.legId).is("legiscan_people_id", null)))).forEach(note);
}
for (const b of chunk(links, 25)) {
  (await Promise.all(b.map((x) => sb.from("bill_vote_members").update({ legislator_id: x.legId }).eq("legiscan_people_id", x.pid).is("legislator_id", null)))).forEach(note);
}
const named = [...people.entries()].filter(([pid]) => rowsByPid.get(pid)?.some((r) => !r.legislator_name));
for (const b of chunk(named, 25)) {
  (await Promise.all(b.map(([pid, p]) => sb.from("bill_vote_members").update({ legislator_name: personName(p).slice(0, 200) }).eq("legiscan_people_id", pid).eq("legislator_name", "")))).forEach(note);
}
for (const [legId, ids] of osLinks) {
  for (const b of chunk(ids, 200)) note(await sb.from("bill_vote_members").update({ legislator_id: legId }).in("id", b).is("legislator_id", null));
}

const { count: total } = await sb.from("bill_vote_members").select("id", { count: "exact", head: true });
const { count: tied } = await sb.from("bill_vote_members").select("id", { count: "exact", head: true }).not("legislator_id", "is", null);
const { count: blank } = await sb.from("bill_vote_members").select("id", { count: "exact", head: true }).eq("legislator_name", "");
console.log(`=== READ-BACK: ${tied}/${total} votes tied to a legislator (${(100 * tied / total).toFixed(1)}%), ${blank} still unnamed, ${errs} write errors ===`);
await record(errs ? "partial" : "success",
  `${tied}/${total} votes tied · ${blank} unnamed · ${newLinks.length} new links · ${errs} errors${budgetStop ? " · stopped at LegiScan budget" : ""} · legiscan_calls=${client.calls}`,
  rowsLinked + rowsNamed + osRows);

async function record(status, notes, rows = 0) {
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: started.toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes,
    });
  } catch { /* best-effort */ }
}
