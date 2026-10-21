/**
 * sync-state-roster-diff.mjs — keep every state legislature roster current
 * with no human in the loop (owner: "the most important thing we need to do…
 * we don't want old officials being emailed").
 *
 * The officials-turnover engine, part 5 (private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md).
 * Compares our ACTIVE state legislators with the keyless openstates/people
 * roster on the exact `ocd-person` id (never a name guess):
 *
 *   - in openstates' retired/ and not current → we mark them NO LONGER IN
 *     OFFICE (active = false), with their recorded end date. Campaign
 *     targeting already filters on `active`, so nobody emails them again.
 *   - current in openstates and missing from ours → a new member (an
 *     election winner once sworn in, an appointee, a special-election winner)
 *     is added, sourced.
 *   - in neither → reported only (an id change upstream is not a departure).
 *
 * Why not compute end dates: openstates publishes end dates for 6 of 7,346
 * current state roles, and start + term length is wrong for every appointee
 * (see backfill-state-term-dates.mjs). The roster itself is the reliable
 * signal, so this runs weekly, and daily through the post-election
 * swearing-in window.
 *
 * Safety: a state whose departures exceed SUSPICIOUS_SHARE of its roster in
 * one run is reported, not applied (an upstream data accident must not wipe a
 * legislature), and the run alerts via scraper_runs.
 *
 *   node --env-file=.env.local scripts/sync-state-roster-diff.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-state-roster-diff.mjs            # apply
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball, toIsoDay, currentRole } from "./lib/openstates-people.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const t0 = Date.now();
const today = new Date().toISOString().slice(0, 10);
const SUSPICIOUS_SHARE = 0.4;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// data/us/ in the same repo is the US CONGRESS: exclude it (see backfill-state-term-dates.mjs).
const PATH_RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/(legislature|retired)\/[^/]+\.ya?ml$/i;
const ROLE_TYPES = new Set(["upper", "lower", "legislature"]);
const ROLE_MAP = { upper: "state_senate", lower: "state_house", legislature: "state_senate" };

async function telemetry(status, notes, rows = 0) {
  try {
    await sb.from("scraper_runs").insert({
      source: "state_roster_diff", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes: String(notes).slice(0, 500),
    });
  } catch { /* best-effort */ }
}

console.log("state roster diff: downloading openstates/people…");
let files;
try {
  files = await collectFromTarball(PEOPLE_TARBALL, PATH_RE);
} catch (e) {
  await telemetry("error", `tarball: ${e.message}`);
  throw e;
}

const current = new Map(); // ocd id -> { state, doc, role }
const retired = new Map(); // ocd id -> { state, doc, end }
for (const [path, text] of files) {
  const m = PATH_RE.exec(path);
  if (!m) continue;
  let doc;
  try { doc = yaml.load(text); } catch { continue; }
  if (!doc?.id) continue;
  const state = m[1].toUpperCase();
  if (m[2].toLowerCase() === "legislature") {
    const role = currentRole(doc, ROLE_TYPES, today);
    if (role) current.set(doc.id, { state, doc, role });
  } else {
    const ends = (doc.roles ?? []).filter((r) => ROLE_TYPES.has(String(r?.type ?? "").toLowerCase())).map((r) => toIsoDay(r.end_date)).filter(Boolean).sort();
    retired.set(doc.id, { state, doc, end: ends[ends.length - 1] ?? null });
  }
}
console.log(`openstates: ${current.size} current, ${retired.size} retired`);

// Ours: every state legislator with an openstates id. Page with .order(), or
// pages overlap (memory: supabase-postgrest-1000-row-cap).
const ours = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("legislators")
    .select("id, openstates_id, full_name, state, role, active")
    .eq("level", "state").in("role", ["state_senate", "state_house"]).not("openstates_id", "is", null)
    .order("id").range(from, from + 999);
  if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
  ours.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const oursByOcd = new Map(ours.map((r) => [r.openstates_id, r]));
const activeByState = new Map();
for (const r of ours) if (r.active) activeByState.set(r.state, (activeByState.get(r.state) ?? 0) + 1);

// openstates also covers territories (PR) that we don't track; only add
// members of jurisdictions in our states table.
const { data: stateRows } = await sb.from("states").select("abbr");
const tracked = new Set((stateRows ?? []).map((s) => s.abbr));

const departed = ours.filter((r) => r.active && !current.has(r.openstates_id) && retired.has(r.openstates_id));
const orphans = ours.filter((r) => r.active && !current.has(r.openstates_id) && !retired.has(r.openstates_id));
const newcomers = [...current.entries()].filter(([ocd, c]) => !oursByOcd.has(ocd) && tracked.has(c.state));

// Per-state sanity cap on departures.
const departByState = new Map();
for (const r of departed) departByState.set(r.state, [...(departByState.get(r.state) ?? []), r]);
const held = new Set();
for (const [st, list] of departByState) {
  if (list.length / Math.max(1, activeByState.get(st) ?? 0) > SUSPICIOUS_SHARE) held.add(st);
}

console.log(`departed: ${departed.length} (held for review in: ${[...held].join(", ") || "none"}) · new: ${newcomers.length} · orphans: ${orphans.length}`);
for (const r of departed.slice(0, 25)) console.log(`  - leaving: ${r.state} ${r.full_name} (end ${retired.get(r.openstates_id).end ?? "?"})${held.has(r.state) ? " [HELD]" : ""}`);
for (const [, c] of newcomers.slice(0, 25)) console.log(`  + new: ${c.state} ${c.doc.name} (${c.role.type} ${c.role.district}, from ${toIsoDay(c.role.start_date) ?? "?"})`);

let deactivated = 0, added = 0, failed = 0;
const errors = [];
if (!DRY) {
  for (const r of departed) {
    if (held.has(r.state)) continue;
    const end = retired.get(r.openstates_id).end;
    const { error } = await sb.from("legislators").update({
      active: false,
      ...(end ? { term_end_date: end } : {}),
      last_synced_at: new Date().toISOString(),
    }).eq("id", r.id).eq("active", true);
    if (error) failed++; else deactivated++;
  }
  // A newcomer may already be on our roster WITHOUT an openstates id (added by
  // hand or another sync). Same state + same name means skip, never duplicate.
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const { data: noId } = await sb.from("legislators").select("state, full_name")
    .eq("level", "state").eq("active", true).is("openstates_id", null).limit(5000);
  const existingNames = new Set((noId ?? []).map((r) => `${r.state}|${norm(r.full_name)}`));
  for (const [ocd, c] of newcomers) {
    const d = c.doc;
    if (existingNames.has(`${c.state}|${norm(d.name)}`)) continue;
    const party = Array.isArray(d.party) ? d.party.find((p) => !p.end_date)?.name ?? d.party[0]?.name : null;
    const office = Array.isArray(d.offices) ? d.offices.find((o) => o.classification === "capitol") ?? d.offices[0] : null;
    const { error } = await sb.from("legislators").insert({
      state: c.state, level: "state", role: ROLE_MAP[String(c.role.type).toLowerCase()] ?? "state_house",
      district: c.role.district != null ? String(c.role.district) : null,
      full_name: d.name, party, email: d.email ?? null, phone: office?.voice ?? null,
      openstates_id: ocd, active: true, term_start_date: toIsoDay(c.role.start_date),
      last_synced_at: new Date().toISOString(),
      verified_sources_md: `- Source: openstates/people (${ocd})\n- Added by sync-state-roster-diff ${today}: a current member not yet on our roster.`,
    });
    if (error) { failed++; if (errors.length < 5) errors.push(`${c.state} ${d.name}: ${error.message}`); } else added++;
  }
}
for (const e of errors) console.log(`  ! ${e}`);

const summary = `${DRY ? "DRY " : ""}departed ${departed.length} (applied ${deactivated}, held states: ${[...held].join(",") || "none"}) · new ${newcomers.length} (added ${added}) · orphans ${orphans.length} · failed ${failed} · ${Math.round((Date.now() - t0) / 1000)}s`;
console.log(summary);
await telemetry(failed > 0 || held.size > 0 ? "error" : deactivated + added > 0 ? "success" : "empty", summary, deactivated + added);
