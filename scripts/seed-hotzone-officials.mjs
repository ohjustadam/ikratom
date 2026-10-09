#!/usr/bin/env node
/**
 * seed-hotzone-officials.mjs — when kratom lands on a town's agenda, map who
 * decides there BEFORE anyone needs to email them.
 *
 * WHY (2026-10-03): every approved meeting in the last 60 days was in a town
 * with ZERO officials on file (Clifton Park NY, Corinth TX, Springfield MA,
 * Albany County NY...), so the hearing alert could not say who votes or how to
 * reach them. The local-reps pipeline (cron-localreps-cloud.yml) already
 * resolves a council roster from a request in local_rep_requests; nothing was
 * filing those requests for hot zones.
 *
 * For every meeting that is approved or still pending and dated from 60 days
 * ago onward, this files a coverage request for:
 *   ring 0  the meeting's own body (municipal or county by its name)
 *   ring 1  the parent county (Census places file; Wikidata fallback)
 *   ring 2  every county bordering that one (Census county adjacency) —
 *           bans spread to the next county over, so map it before it does
 * ...whenever no ACTIVE official is on file for that locality and level.
 * Idempotent (upsert on the queue's unique key). Requests are filed under the
 * owner's account so they show in /admin/local-rep-requests like any other.
 * Ring 2 is capped at --max-ring2 NEW requests per run (default 12) so the
 * roster pipeline drains it over a few days instead of in one flood.
 *
 *   node --env-file=.env.local scripts/seed-hotzone-officials.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { classifyUsPlace } from "./lib/place-classify.mjs";
import { countyForPlace, neighborCounties } from "./lib/census-geo.mjs";
import { noCountyGovernment } from "./lib/no-county-government.mjs";

const DRY = process.argv.includes("--dry-run");
const argAt = process.argv.indexOf("--max-ring2");
const MAX_RING2 = argAt > 0 ? Number(process.argv[argAt + 1]) || 0 : 12;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();

const STATE_BODY = /legislat|general assembly|state (senate|house)|house of representatives|state board/i;
const levelOf = (locality) => (/\b(county|parish|borough)\b/i.test(locality) ? "county" : "municipal");

async function covered(state, locality, level) {
  const { count } = await sb.from("legislators").select("id", { count: "exact", head: true })
    .eq("level", level).eq("active", true).eq("locality", locality);
  return (count ?? 0) > 0;
}

const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).single();
const { data: meetings, error } = await sb.from("municipal_meetings").select("state, locality, body_name, meeting_at, moderation_status")
  .in("moderation_status", ["approved", "pending_review"]).not("locality", "is", null)
  .gte("meeting_at", new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(500);
if (error) { console.error(error.message); process.exit(1); }

const targets = new Map(); // key -> {state, locality, level, ring}
// pri: lower = more urgent. Approved beats pending; within each, the newest/upcoming meeting wins,
// so the ring-2 cap goes to towns about to vote, not to last summer's.
const add = (state, locality, level, ring, pri) => {
  const key = `${state}|${locality}|${level}`;
  const cur = targets.get(key);
  if (!cur || cur.ring > ring || (cur.ring === ring && cur.pri > pri)) targets.set(key, { state, locality, level, ring, pri });
};

async function parentCounty(state, locality) {
  try { const c = await countyForPlace(state, locality); if (c) return c; } catch { /* Census unreachable — try Wikidata */ }
  try {
    const place = await classifyUsPlace(state, locality);
    if (place.parentAdmin && /county|parish|borough/i.test(place.parentAdmin)) return `${place.parentAdmin.replace(/,.*$/, "")}, ${state}`;
  } catch { /* best-effort */ }
  return null;
}

const hotCounties = new Map(); // county -> pri
for (const m of meetings) {
  const level = levelOf(m.locality);
  const pri = (m.moderation_status === "approved" ? 0 : 1e13) - Date.parse(m.meeting_at);
  add(m.state, m.locality, level, 0, pri);
  // A statehouse session held in the capital is a STATE fight, not a local hot zone:
  // map the capital's own council but don't fan out to its neighbours.
  if (STATE_BODY.test(m.body_name ?? "")) continue;
  const county = level === "county" ? m.locality : await parentCounty(m.state, m.locality);
  if (!county) continue;
  if (level === "municipal") add(m.state, county, "county", 1, pri);
  hotCounties.set(county, Math.min(pri, hotCounties.get(county) ?? Infinity));
}
for (const [county, pri] of [...hotCounties].sort((a, b) => a[1] - b[1])) {
  let near = [];
  try { near = await neighborCounties(county); } catch { /* ring 2 is best-effort */ }
  for (const n of near) {
    const st = n.slice(-2);
    // Cross-state neighbours count too — a ban in one state's border county
    // is the next state's early warning.
    add(st, n, "county", 2, pri);
  }
}

// Requests already open (or already decided as rejected) — ring 2's cap counts NEW filings only.
const { data: open } = await sb.from("local_rep_requests").select("state, locality, level")
  .eq("user_id", owner.id).in("status", ["pending", "rejected"]).limit(1000);
const alreadyOpen = new Set((open ?? []).map((r) => `${r.state}|${r.locality}|${r.level}`));

let filed = 0, alreadyCovered = 0, queued = 0, ring2New = 0, deferred = 0, noGov = 0;
const ordered = [...targets.entries()].sort((a, b) => a[1].ring - b[1].ring || a[1].pri - b[1].pri);
for (const [key, t] of ordered) {
  // CT / RI / most of MA have no county government — a county roster request
  // there can never be filled (6 rejected by hand on 2026-10-08).
  if (t.level === "county" && noCountyGovernment(t.state, t.locality)) { noGov++; continue; }
  if (await covered(t.state, t.locality, t.level)) { alreadyCovered++; continue; }
  if (alreadyOpen.has(key)) { queued++; continue; }
  if (t.ring === 2) {
    if (ring2New >= MAX_RING2) { deferred++; continue; }
    ring2New++;
  }
  console.log(`${DRY ? "[dry] " : ""}request ${t.level} roster: ${t.locality} (ring ${t.ring})`);
  if (DRY) { filed++; continue; }
  const { error: e } = await sb.from("local_rep_requests").upsert(
    { user_id: owner.id, state: t.state, locality: t.locality, level: t.level, status: "pending", source: "hotzone_seed" },
    { onConflict: "user_id,state,locality,level", ignoreDuplicates: true },
  );
  if (!e) filed++; else console.log(`  ✗ ${e.message}`);
}

const summary = `${meetings.length} meeting rows · ${targets.size} localities (${hotCounties.size} hot counties) · ${filed} roster requests filed · ${queued} already queued · ${alreadyCovered} already covered · ${deferred} ring-2 deferred to later runs · ${noGov} skipped (no county government)`;
console.log(summary);
if (!DRY) await sb.from("scraper_runs").insert({ source: "seed_hotzone_officials", started_at: startedAt, finished_at: new Date().toISOString(), status: "success", rows_updated: filed, notes: summary });
