#!/usr/bin/env node
/**
 * resolve-pending-meetings.mjs — clear the meeting review queue without a
 * human, using only rules a person would apply and can audit. NO model call.
 *
 * WHY (2026-10-03): the queue held 7 upcoming "meetings". One was a duplicate
 * of a hearing already on the calendar (same town, same day, re-found with no
 * time), and five were laws taking effect on Nov 1 / Jan 1, lifted from news
 * articles. The owner approved the duplicate in good faith because nothing
 * said it was one. Meanwhile real hearings wait on a person who is asleep.
 *
 * The independent check lives elsewhere on purpose. discover-municipal-
 * meetings.mjs seeds its warm lane with every pending row's TOWN (never the
 * article's claim) and runs the full fetch-read-quote-date pipeline; a hit is
 * written with verified provenance and auto-approve-meetings.mjs may publish
 * it. This script only reconciles the queue afterwards:
 *
 *  1. SUPERSEDED — another row for the same state + town on the same local
 *     date (±1 day) is approved, or is pending WITH verified provenance.
 *     The news row is retired in favour of the verified one.
 *  2. NOT A MEETING — no governing body named, and either the text says a law
 *     takes effect / expires / was signed, or the date is the 1st of a month
 *     (the classic effective date). Rejected with the rule that fired.
 *
 * Everything else stays pending and alert-pending-meetings.mjs keeps paging
 * the owner. Rejections append the reason to ai_notes, so /admin/meetings
 * shows why, and any human can flip one back.
 *
 *   node --env-file=.env.local scripts/resolve-pending-meetings.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();
const VERIFIED_VIA = new Set(["searxng_verified", "gemini_lead_verified"]);
const NOT_A_MEETING = /\b(effective|takes? effect|go(?:es)? into effect|in effect|expir\w*|sunset\w*|signed into law|signs? (?:the )?(?:bill|law)|enacted|becomes? law|ban begins)\b/i;

const etDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
const dayGap = (a, b) => Math.abs(Date.parse(etDay(a)) - Date.parse(etDay(b))) / 86_400_000;
const sameTown = (a, b) => a.state === b.state && String(a.locality ?? "").toLowerCase() === String(b.locality ?? "").toLowerCase();

const COLS = "id, state, locality, body_name, meeting_at, moderation_status, discovered_via, source_url, ai_notes, agenda_text";
const { data: pending, error } = await sb.from("municipal_meetings").select(COLS)
  .eq("moderation_status", "pending_review").gte("meeting_at", new Date(Date.now() - 86_400_000).toISOString()).limit(500);
if (error) { console.error(error.message); process.exit(1); }
const { data: others } = await sb.from("municipal_meetings").select(COLS)
  .in("moderation_status", ["approved", "pending_review"]).gte("meeting_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(2000);

const decisions = [];
for (const m of pending) {
  const twin = VERIFIED_VIA.has(m.discovered_via) ? null : (others ?? []).find((o) =>
    o.id !== m.id && sameTown(o, m) && m.locality && dayGap(o.meeting_at, m.meeting_at) <= 1 &&
    (o.moderation_status === "approved" || VERIFIED_VIA.has(o.discovered_via)));
  if (twin) { decisions.push({ m, reason: `superseded by ${twin.moderation_status} ${twin.discovered_via} row ${twin.id} (same town, ${etDay(twin.meeting_at)})` }); continue; }

  if (!VERIFIED_VIA.has(m.discovered_via)) {
    const text = `${m.ai_notes ?? ""} ${m.agenda_text ?? ""}`;
    // The extractor labels its own output; when IT says effective date, believe it.
    if (/\bkind=effective_date\b/.test(m.ai_notes ?? "")) { decisions.push({ m, reason: "not a meeting: the extractor classified it as a law's effective date" }); continue; }
    // A kratom platform's calendar has no business listing a THC drink ban or a general election.
    if (!/kratom|7-?oh|mitragyn/i.test(text)) { decisions.push({ m, reason: "not kratom-related: neither the source nor the agenda mentions kratom, 7-OH or mitragynine" }); continue; }
  }

  if (!m.body_name && !VERIFIED_VIA.has(m.discovered_via)) {
    const text = `${m.ai_notes ?? ""} ${m.agenda_text ?? ""}`;
    const hit = text.match(NOT_A_MEETING);
    if (hit) { decisions.push({ m, reason: `not a meeting: no governing body named and the source says "${hit[0]}"` }); continue; }
    if (etDay(m.meeting_at).endsWith("-01")) { decisions.push({ m, reason: "not a meeting: no governing body named and the date is the 1st of the month (a typical law effective date)" }); continue; }
  }
}

for (const { m, reason } of decisions) {
  console.log(`${DRY ? "[dry] " : ""}reject ${m.locality ?? m.state} ${etDay(m.meeting_at)} · ${reason}`);
  if (DRY) continue;
  const note = `${m.ai_notes ? `${m.ai_notes} · ` : ""}[resolver ${startedAt.slice(0, 10)}] ${reason}`.slice(0, 2000);
  await sb.from("municipal_meetings").update({ moderation_status: "rejected", moderation_reviewed_at: new Date().toISOString(), ai_notes: note })
    .eq("id", m.id).eq("moderation_status", "pending_review"); // never overrides a human decision made meanwhile
}

const kept = pending.length - decisions.length;
const summary = `${pending.length} pending · ${decisions.length} resolved (${decisions.filter((d) => d.reason.startsWith("superseded")).length} superseded, ${decisions.filter((d) => d.reason.startsWith("not a meeting")).length} not-a-meeting) · ${kept} left for review`;
console.log(summary);
if (!DRY) await sb.from("scraper_runs").insert({ source: "resolve_pending_meetings", started_at: startedAt, finished_at: new Date().toISOString(), status: "success", rows_updated: decisions.length, notes: summary });
