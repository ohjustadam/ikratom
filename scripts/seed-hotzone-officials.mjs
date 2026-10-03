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
 *   ring 1  the parent county, when classifyUsPlace knows it (Wikidata)
 * ...whenever no ACTIVE official is on file for that locality and level.
 * Idempotent (upsert on the queue's unique key). Requests are filed under the
 * owner's account so they show in /admin/local-rep-requests like any other.
 *
 * Next ring (not built): neighbouring towns via Census place adjacency.
 *
 *   node --env-file=.env.local scripts/seed-hotzone-officials.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { classifyUsPlace } from "./lib/place-classify.mjs";

const DRY = process.argv.includes("--dry-run");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();

const levelOf = (locality) => (/\b(county|parish|borough)\b/i.test(locality) ? "county" : "municipal");

async function covered(state, locality, level) {
  const { count } = await sb.from("legislators").select("id", { count: "exact", head: true })
    .eq("level", level).eq("active", true).eq("locality", locality);
  return (count ?? 0) > 0;
}

const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).single();
const { data: meetings, error } = await sb.from("municipal_meetings").select("state, locality, moderation_status")
  .in("moderation_status", ["approved", "pending_review"]).not("locality", "is", null)
  .gte("meeting_at", new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(500);
if (error) { console.error(error.message); process.exit(1); }

const targets = new Map(); // key -> {state, locality, level, ring}
for (const m of meetings) {
  const level = levelOf(m.locality);
  targets.set(`${m.state}|${m.locality}|${level}`, { state: m.state, locality: m.locality, level, ring: 0 });
  if (level === "municipal") {
    try {
      const place = await classifyUsPlace(m.state, m.locality);
      if (place.parentAdmin && /county|parish|borough/i.test(place.parentAdmin)) {
        const county = `${place.parentAdmin.replace(/,.*$/, "")}, ${m.state}`;
        targets.set(`${m.state}|${county}|county`, { state: m.state, locality: county, level: "county", ring: 1 });
      }
    } catch { /* ring 1 is best-effort */ }
  }
}

let filed = 0, alreadyCovered = 0;
for (const t of targets.values()) {
  if (await covered(t.state, t.locality, t.level)) { alreadyCovered++; continue; }
  console.log(`${DRY ? "[dry] " : ""}request ${t.level} roster: ${t.locality} (ring ${t.ring})`);
  if (DRY) { filed++; continue; }
  const { error: e } = await sb.from("local_rep_requests").upsert(
    { user_id: owner.id, state: t.state, locality: t.locality, level: t.level, status: "pending" },
    { onConflict: "user_id,state,locality,level", ignoreDuplicates: true },
  );
  if (!e) filed++; else console.log(`  ✗ ${e.message}`);
}

const summary = `${meetings.length} meeting rows · ${targets.size} localities · ${filed} roster requests filed · ${alreadyCovered} already covered`;
console.log(summary);
if (!DRY) await sb.from("scraper_runs").insert({ source: "seed_hotzone_officials", started_at: startedAt, finished_at: new Date().toISOString(), status: "success", rows_updated: filed, notes: summary });
