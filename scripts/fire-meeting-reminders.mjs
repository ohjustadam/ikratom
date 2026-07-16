#!/usr/bin/env node
/**
 * Fire 7-day / 3-day / 1-day push reminders for approved meetings
 * coming up. Runs once a day via cron.
 *
 * For each approved meeting with `meeting_at` falling in one of the
 * reminder windows AND a NULL `reminder_Xd_sent_at`, this script:
 *   1. Finds in-state users
 *   2. Inserts a `meeting_upcoming` in-app notification per user
 *   3. Lets the hourly push fan-out (fanoutPushNotifications) deliver — it
 *      COALESCES all of a user's pending rows into ONE buzz and honors
 *      opt-out (in_app/digest), the notify_meetings category mute, DND /
 *      quiet-hours, and the per-user rate-cap. (This script no longer
 *      direct-sends: a per-item direct push double-buzzed users because the
 *      fan-out re-delivered the same pushed_at=NULL rows an hour later.)
 *   4. Stamps `reminder_Xd_sent_at` so the next cron run skips it
 *
 * Windows (in days from now):
 *   7-day window: meeting_at in [6.5d, 7.5d]
 *   3-day window: meeting_at in [2.5d, 3.5d]
 *   1-day window: meeting_at in [0.5d, 1.5d]
 *
 * Skips meetings that have already been broadcast (broadcast_at NOT NULL)
 * — those advocates already got a "LIVE NOW" push and don't need a
 * separate reminder.
 *
 * Run:
 *   node --env-file=.env.local scripts/fire-meeting-reminders.mjs
 *   node --env-file=.env.local scripts/fire-meeting-reminders.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

const WINDOWS = [
  { days: 7, col: "reminder_7d_sent_at", lower: 6.5, upper: 7.5, label: "7 days" },
  { days: 3, col: "reminder_3d_sent_at", lower: 2.5, upper: 3.5, label: "3 days" },
  { days: 1, col: "reminder_1d_sent_at", lower: 0.5, upper: 1.5, label: "tomorrow" },
];

async function fireWindow(win) {
  const now = Date.now();
  const lowerIso = new Date(now + win.lower * 86_400_000).toISOString();
  const upperIso = new Date(now + win.upper * 86_400_000).toISOString();

  const { data: meetings, error: queryErr } = await sb
    .from("municipal_meetings")
    .select("id, state, locality, body_name, meeting_at, zoom_url, livestream_url, agenda_url")
    .eq("moderation_status", "approved")
    .is("broadcast_at", null)        // skip those that already got the live push
    .is(win.col, null)
    .gte("meeting_at", lowerIso)
    .lte("meeting_at", upperIso)
    .limit(200);

  if (queryErr) {
    // Most likely the reminder_Nd_sent_at column hasn't been migrated yet.
    // Surface the error rather than silently no-op.
    console.log(`  ${win.label}: query failed — ${queryErr.message?.slice(0, 120)}`);
    return { window: win.label, sent: 0, recipients: 0, error: queryErr.message };
  }
  if (!meetings || meetings.length === 0) {
    console.log(`  ${win.label}: nothing in window`);
    return { window: win.label, sent: 0, recipients: 0 };
  }

  let totalRecipients = 0;
  for (const m of meetings) {
    // Find in-state users
    const { data: users } = await sb
      .from("profiles")
      .select("id")
      .eq("state", m.state)
      .limit(50_000);
    const userIds = (users ?? []).map((u) => u.id);

    if (userIds.length === 0) {
      console.log(`    · ${m.locality ?? m.state} (no in-state users) — stamping anyway`);
      if (!DRY_RUN) {
        await sb.from("municipal_meetings").update({ [win.col]: new Date().toISOString() }).eq("id", m.id);
      }
      continue;
    }

    const title = `📅 ${win.label === "tomorrow" ? "Tomorrow" : `In ${win.label}`}: ${m.locality ?? m.state} meeting on kratom`;
    const body = `${m.body_name ?? "Public meeting"} — get the Zoom link + agenda details.`;
    const link = `/meetings/${m.id}`;

    if (DRY_RUN) {
      console.log(`    [dry] would send "${title}" to ${userIds.length} ${m.state} users`);
      continue;
    }

    // In-app notifications
    const rows = userIds.map((uid) => ({
      user_id: uid,
      kind: "meeting_upcoming",
      title,
      body,
      link,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from("notifications").insert(chunk);
      if (error) console.log(`    ✗ notif chunk: ${error.message?.slice(0, 80)}`);
    }

    // Delivery is handled by the hourly push fan-out (fanoutPushNotifications
    // via /api/cron/fire-waves), which coalesces this row with anything else
    // the user has pending into ONE buzz and honors every opt-out + DND +
    // rate-cap. No direct send here — that was the source of the double-buzz.

    // Stamp so we don't re-fire
    await sb.from("municipal_meetings").update({ [win.col]: new Date().toISOString() }).eq("id", m.id);

    totalRecipients += userIds.length;
    console.log(`    ✓ ${m.locality ?? m.state}: ${userIds.length} notif queued (delivered via fan-out)`);
  }

  return { window: win.label, sent: meetings.length, recipients: totalRecipients };
}

// ---------- main ----------
console.log(`Firing meeting reminders${DRY_RUN ? " [DRY RUN]" : ""}…\n`);
const t0 = Date.now();
const results = [];
for (const win of WINDOWS) {
  console.log(`Window: ${win.label}`);
  const r = await fireWindow(win);
  results.push(r);
  console.log("");
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const totalMeetings = results.reduce((s, r) => s + (r.sent ?? 0), 0);
const totalRecipients = results.reduce((s, r) => s + (r.recipients ?? 0), 0);
console.log(`Done in ${elapsed}s — ${totalMeetings} meeting reminders, ${totalRecipients} user notifications.`);

try {
  await sb.from("scraper_runs").insert({
    source: "fire_meeting_reminders",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalMeetings > 0 ? "success" : "empty",
    rows_added: totalRecipients,
    notes: results.map((r) => `${r.window}: ${r.sent ?? 0} meetings, ${r.recipients ?? 0} users`).join(" · "),
  });
} catch { /* best-effort */ }
process.exit(0);
