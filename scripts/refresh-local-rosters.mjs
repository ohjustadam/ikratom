#!/usr/bin/env node
/**
 * refresh-local-rosters.mjs — keep "who decides" true after elections.
 *
 * WHY (2026-10-03): a locality's council roster was resolved once and never
 * re-checked. 20 local officials whose recorded term had ENDED were still
 * active, and 135 of 151 localities will pass the meeting page's 180-day
 * "may be out of date" line within three months. Councils turn over at
 * elections (the next general is 2026-11-03), so an advocate emailing "the
 * council" could be writing to people who no longer serve.
 *
 * Re-queues a locality's roster request (status back to 'pending') for the
 * existing local-reps pipeline when ANY of:
 *   - an active official's term_end_date has passed
 *   - the freshest check is older than STALE_DAYS (150, ahead of the UI's 180)
 *   - a hearing there is approved within 30 days and the check is 60+ days old
 * auto-fulfill-pending-local-reps.mjs then re-confirms (bumps the check date),
 * adds newcomers, and retires departed members only on strong evidence.
 * Capped per run so the shared pipeline drains it over days.
 *
 *   node --env-file=.env.local scripts/refresh-local-rosters.mjs --dry-run [--max 8]
 */
import { createClient } from "@supabase/supabase-js";
import { noCountyGovernment } from "./lib/no-county-government.mjs";

const DRY = process.argv.includes("--dry-run");
const maxAt = process.argv.indexOf("--max");
const MAX = maxAt > 0 ? Number(process.argv[maxAt + 1]) || 8 : 8;
const STALE_DAYS = 150;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();
const now = Date.now();
const DAY = 86_400_000;

const officials = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("legislators")
    .select("state, locality, level, last_synced_at, created_at, term_end_date")
    .in("level", ["municipal", "county"]).eq("active", true).not("locality", "is", null)
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  officials.push(...data);
  if (data.length < 1000) break;
}

const { data: soon } = await sb.from("municipal_meetings").select("locality")
  .eq("moderation_status", "approved").not("locality", "is", null)
  .gte("meeting_at", new Date(now).toISOString()).lte("meeting_at", new Date(now + 30 * DAY).toISOString());
const hearingSoon = new Set((soon ?? []).map((m) => m.locality));

const locs = new Map(); // key -> { state, locality, level, ageDays, termEnded }
for (const o of officials) {
  const key = `${o.state}|${o.locality}|${o.level}`;
  const age = (now - Date.parse(o.last_synced_at ?? o.created_at)) / DAY;
  const l = locs.get(key) ?? { state: o.state, locality: o.locality, level: o.level, ageDays: Infinity, termEnded: 0 };
  l.ageDays = Math.min(l.ageDays, age);
  if (o.term_end_date && Date.parse(o.term_end_date) < now) l.termEnded++;
  locs.set(key, l);
}

const due = [...locs.values()].map((l) => {
  const reason = l.termEnded > 0 ? `${l.termEnded} term(s) ended`
    : hearingSoon.has(l.locality) && l.ageDays >= 60 ? `hearing within 30 days, checked ${Math.round(l.ageDays)}d ago`
    : l.ageDays >= STALE_DAYS ? `checked ${Math.round(l.ageDays)}d ago`
    : null;
  // Order: ended terms first, then upcoming hearings, then plain staleness (oldest first).
  const rank = l.termEnded > 0 ? 0 : hearingSoon.has(l.locality) ? 1 : 2;
  return { ...l, reason, rank };
  // No county government (Middlesex MA keeps a sheriff/DA on file): there is no
  // roster page for the batch to re-read, so re-queueing just churns. Hand-kept.
}).filter((l) => l.reason && !(l.level === "county" && noCountyGovernment(l.state, l.locality))).sort((a, b) => a.rank - b.rank || b.ageDays - a.ageDays);

const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).single();
const { data: open } = await sb.from("local_rep_requests").select("state, locality, level").eq("status", "pending").limit(2000);
const alreadyPending = new Set((open ?? []).map((r) => `${r.state}|${r.locality}|${r.level}`));

let queued = 0, skipped = 0;
for (const l of due) {
  const key = `${l.state}|${l.locality}|${l.level}`;
  if (alreadyPending.has(key)) { skipped++; continue; }
  if (queued >= MAX) break;
  console.log(`${DRY ? "[dry] " : ""}refresh ${l.level} roster: ${l.locality} — ${l.reason}`);
  queued++;
  if (DRY) continue;
  const { data: mine } = await sb.from("local_rep_requests").select("id")
    .eq("user_id", owner.id).eq("state", l.state).eq("locality", l.locality).eq("level", l.level).maybeSingle();
  const { error } = mine
    ? await sb.from("local_rep_requests").update({ status: "pending", resolved_at: null }).eq("id", mine.id)
    : await sb.from("local_rep_requests").insert({ user_id: owner.id, state: l.state, locality: l.locality, level: l.level, status: "pending" });
  if (error) console.log(`  ✗ ${error.message}`);
}

const summary = `${locs.size} localities · ${due.length} due (${due.filter((d) => d.rank === 0).length} with ended terms) · ${queued} re-queued · ${skipped} already pending · ${Math.max(0, due.length - queued - skipped)} left for later runs`;
console.log(summary);
if (!DRY) await sb.from("scraper_runs").insert({ source: "refresh_local_rosters", started_at: startedAt, finished_at: new Date().toISOString(), status: "success", rows_updated: queued, notes: summary });
