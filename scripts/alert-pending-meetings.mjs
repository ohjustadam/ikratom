#!/usr/bin/env node
/**
 * alert-pending-meetings.mjs — tell the owner a real hearing is waiting on him.
 *
 * WHY THIS EXISTS (2026-09-28). Discovery finally worked: its run wrote three
 * genuine kratom hearings, each verified against an official .gov page —
 *
 *   Corinth TX, Planning & Zoning, "Kratom Stores"            — that same night
 *   Coos County OR, "Proposed Ordinances to Ban Kratom"       — two days out
 *   Clifton Park NY, "NOTICE OF PUBLIC HEARING ... KRATOM"    — eight days out
 *
 * — and every one of them landed in `pending_review` where NOTHING said so. The
 * pipeline is deliberately conservative: a row only auto-publishes when code can
 * prove the quote, the date, the time and the agenda context, and these were
 * held at 0.75 because the page listed several hearings. That caution is right.
 * But "held for a human" only works if a human is told, and the cost of silence
 * here is the whole point of the platform: a ban hearing passes unattended.
 *
 * So this is the other half of the provenance gate. Auto-publish stays strict;
 * the owner gets a push naming what is waiting and how soon it happens.
 *
 * ONE PUSH PER DAY, not one per meeting. Notification fatigue is what makes an
 * alert get ignored, and the queue changes slowly — a daily digest with the
 * soonest meeting named is enough to act on. Deliberately NOT gated by the
 * egress budget: an alert that load-sheds is an alert that goes quiet exactly
 * when the platform is busiest.
 *
 * Run:
 *   node --env-file=.env.local scripts/alert-pending-meetings.mjs
 *   node --env-file=.env.local scripts/alert-pending-meetings.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const DRY = process.argv.includes("--dry-run");
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const SOURCE = "alert_pending_meetings";
const RESEND_GUARD_H = 20;   // one push a day, whatever the cron cadence
const HORIZON_DAYS = 45;     // beyond this it is not yet actionable

const t0 = Date.now();
const now = new Date();
// Declared up front because tag() reads them, and tag() also runs on the
// early-exit paths below. Reading a not-yet-initialised const throws even under
// ?. — and inside tag()'s try/catch that silently drops the telemetry row, which
// is the one thing that must never go missing quietly. Third time in this repo.
let when = "";
let place = "";

// Future, still unreviewed, and close enough to act on.
const { data: pending, error } = await sb
  .from("municipal_meetings")
  .select("id, state, locality, body_name, meeting_at, ai_confidence, agenda_text, discovered_via")
  .eq("moderation_status", "pending_review")
  .gte("meeting_at", now.toISOString())
  .lte("meeting_at", new Date(now.getTime() + HORIZON_DAYS * 86_400_000).toISOString())
  .order("meeting_at", { ascending: true })
  .limit(200);

if (error) {
  console.error("query failed:", error.message);
  await tag("error", 0, error.message.slice(0, 200));
  process.exit(1);
}

if (!pending?.length) {
  console.log("No future meetings awaiting review.");
  await tag("empty", 0);
  process.exit(0);
}

const soonest = pending[0];
const days = Math.max(0, Math.round((new Date(soonest.meeting_at) - now) / 86_400_000));
when = days === 0 ? "TODAY" : days === 1 ? "tomorrow" : `in ${days} days`;
// locality is stored canonically as "Place, ST", so appending the state again
// reads "Coos County, OR · OR" in the push title.
place = soonest.locality
  ? String(soonest.locality)
  : (soonest.state ?? "unknown");

console.log(`${pending.length} meeting(s) awaiting review. Soonest: ${place} ${when}.`);
for (const m of pending.slice(0, 8)) {
  console.log(`  ${m.meeting_at.slice(0, 10)}  ${m.locality ?? m.state}  ${m.body_name ?? ""}  conf=${m.ai_confidence ?? "-"}  [${m.discovered_via}]`);
}

// Already pushed recently? Still record the run — the count is the useful signal
// on /admin/automation even on a day nobody is paged.
const { data: last } = await sb
  .from("scraper_runs")
  .select("finished_at")
  .eq("source", SOURCE)
  .eq("status", "success")
  .gte("finished_at", new Date(Date.now() - RESEND_GUARD_H * 3600_000).toISOString())
  .limit(1);

if (last?.length) {
  console.log(`  (already pushed within ${RESEND_GUARD_H}h — not paging again)`);
  await tag("empty", pending.length);
  process.exit(0);
}
if (DRY) {
  console.log("  [dry] would push to the owner");
  process.exit(0);
}

let pushed = 0;
try {
  const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).maybeSingle();
  if (owner) {
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", owner.id);
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (subs?.length && pub && priv) {
      const webpush = createRequire(import.meta.url)("web-push");
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@ikratom.org", pub, priv);
      // Lead with the DEADLINE, not the count — "3 waiting" does not tell you
      // whether to open it now, and the whole risk here is a hearing passing.
      const payload = JSON.stringify({
        title: `🏛 Kratom hearing ${when}: ${place}`,
        body: `${String(soonest.agenda_text ?? "").slice(0, 90)}`
          + (pending.length > 1 ? ` — and ${pending.length - 1} more awaiting review.` : " — awaiting your review."),
        link: "/admin/meetings",
        tag: "pending-meetings",
      });
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload, { TTL: 12 * 3600 },
          );
          pushed++;
        } catch { /* per-subscription best-effort */ }
      }
    }
  }
} catch (e) {
  console.log(`  push failed: ${String(e.message ?? e).slice(0, 90)}`);
}

console.log(`Done — ${pushed} push(es) sent.`);
await tag(pushed > 0 ? "success" : "empty", pending.length);

async function tag(status, count, errMsg = null) {
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE,
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_updated: count,
      error_message: errMsg,
      notes: `${count} awaiting review${count ? ` · soonest ${when} (${place})` : ""}`,
    });
  } catch { /* best-effort */ }
}
