#!/usr/bin/env node
/**
 * Fan out bill subscription notifications to users who opted in:
 *
 *   1. Meeting reminder — bills with local_meta.meeting_at falling
 *      in the next 24h that haven't been reminded yet for this
 *      subscriber. Marks meeting_reminded_at on success.
 *   2. Status change — bills whose status differs from a per-
 *      subscriber last_status_seen tracker. Updates last_status_seen.
 *   3. New linked alert — placeholder for now; deferred to a follow-up
 *      since linking a new policy_alert to an existing bill is rare.
 *
 * Each notification lands in public.notifications, then the existing
 * push fan-out (in /api/cron/fire-waves) delivers via web push to
 * users with push subscribed.
 *
 * Idempotent: cron sweeps every hour, but the per-subscription
 * tracking columns prevent duplicate sends.
 *
 * Run:
 *   node --env-file=.env.local scripts/fanout-bill-reminders.mjs
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const now = new Date();
const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

let totalReminders = 0;
let totalStatus = 0;

// ---------- meeting reminders ----------
// Pull all bill_subscriptions where the subscriber asked for meeting
// reminders + hasn't been reminded yet. Then check each linked bill's
// local_meta.meeting_at — fire a notification if it's in the next 24h.
const { data: subs } = await sb
  .from("bill_subscriptions")
  .select("user_id, bill_id, notify_meeting_reminder, notify_status_change, last_status_seen, meeting_reminded_at")
  .or("notify_meeting_reminder.eq.true,notify_status_change.eq.true");

if (!subs || subs.length === 0) {
  console.log("No bill subscriptions to fan out.");
  process.exit(0);
}
console.log(`Checking ${subs.length} subscription(s)…`);

// Pull bills referenced by these subscriptions in one query
const billIds = Array.from(new Set(subs.map((s) => s.bill_id)));
const { data: bills } = await sb
  .from("bills")
  .select("id, state, bill_number, title, status, local_meta")
  .in("id", billIds);
const billMap = new Map((bills ?? []).map((b) => [b.id, b]));

for (const sub of subs) {
  const bill = billMap.get(sub.bill_id);
  if (!bill) continue;

  // ---------- Meeting reminder ----------
  if (sub.notify_meeting_reminder && !sub.meeting_reminded_at) {
    const meetingAt = bill.local_meta?.meeting_at
      ? new Date(bill.local_meta.meeting_at)
      : null;
    if (meetingAt && !isNaN(meetingAt.getTime())
        && meetingAt > now && meetingAt < in24h) {
      // Within reminder window — fire notification
      const localityLabel = bill.local_meta?.meeting_location ??
        `${bill.state} ${bill.bill_number}`;
      const link = `/bills/${bill.id}`;
      const meetingFmt = meetingAt.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      });
      await sb.from("notifications").insert({
        user_id: sub.user_id,
        kind: "bill_meeting_reminder",
        title: `⏰ Meeting in ~24h: ${bill.bill_number}`,
        body: `${bill.title?.slice(0, 200) ?? ""}\n\nMeeting: ${meetingFmt}\nLocation: ${localityLabel}`,
        link,
      });
      await sb
        .from("bill_subscriptions")
        .update({ meeting_reminded_at: now.toISOString() })
        .eq("user_id", sub.user_id)
        .eq("bill_id", sub.bill_id);
      totalReminders++;
    }
  }

  // ---------- Status change ----------
  if (sub.notify_status_change && bill.status &&
      bill.status !== (sub.last_status_seen ?? "")) {
    // Skip the very first sync — first time we see this subscription
    // we just record the current status without firing a "changed"
    // notification, otherwise every existing subscription pings on
    // first cron run.
    if (sub.last_status_seen === null) {
      await sb
        .from("bill_subscriptions")
        .update({ last_status_seen: bill.status })
        .eq("user_id", sub.user_id)
        .eq("bill_id", sub.bill_id);
    } else {
      await sb.from("notifications").insert({
        user_id: sub.user_id,
        kind: "bill_status_change",
        title: `📋 ${bill.bill_number}: ${sub.last_status_seen} → ${bill.status}`,
        body: bill.title?.slice(0, 240) ?? "",
        link: `/bills/${bill.id}`,
      });
      await sb
        .from("bill_subscriptions")
        .update({ last_status_seen: bill.status })
        .eq("user_id", sub.user_id)
        .eq("bill_id", sub.bill_id);
      totalStatus++;
    }
  }
}

console.log(`Done. Meeting reminders fired: ${totalReminders}, status-change notifications fired: ${totalStatus}`);
