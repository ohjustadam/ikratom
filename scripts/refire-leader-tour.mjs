#!/usr/bin/env node
/**
 * One-shot: re-fire the leader tutorial for every advocate leader.
 *
 * What it does, in order:
 *   1. Find all profiles with is_advocate_leader = true.
 *   2. UPDATE profiles SET leader_tour_pending = true for those rows
 *      — the dashboard reads this flag and fires LeaderTour on the
 *      next /dashboard render. (Realtime publication on profiles
 *      isn't standard, so the flag is picked up on the user's next
 *      page load — sign-in, refresh, or any nav into /dashboard.)
 *   3. INSERT a fresh notification per leader with kind
 *      'leader_tour_refire' so a) the bell-icon updates instantly via
 *      Realtime publication on the notifications table, and b) push
 *      fan-out has something to deliver.
 *   4. Send the push immediately via web-push (don't wait for the
 *      hourly cron). Every leader with an active push subscription
 *      gets a phone notification right now.
 *   5. Mark notifications.pushed_at so the next cron run doesn't
 *      double-deliver.
 *
 * Run with:
 *   node --env-file=.env.local scripts/refire-leader-tour.mjs
 *   node --env-file=.env.local scripts/refire-leader-tour.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const dryRun = process.argv.includes("--dry-run");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const VAPID_PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@ikratom.org";
const pushReady = !!(VAPID_PUB && VAPID_PRIV);
if (pushReady) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);
}

const supabase = createClient(URL, SR, { auth: { persistSession: false } });

// 1. Find all leaders.
const { data: leaders, error: leadErr } = await supabase
  .from("profiles")
  .select("id, full_name")
  .eq("is_advocate_leader", true);
if (leadErr) {
  console.error("Failed to query leaders:", leadErr.message);
  process.exit(1);
}
console.log(`Found ${leaders?.length ?? 0} advocate leader(s).`);
if (!leaders || leaders.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
const ids = leaders.map((l) => l.id);

if (dryRun) {
  console.log("DRY RUN — would flip leader_tour_pending + drop notification for:");
  for (const l of leaders) console.log("  -", l.id, l.full_name ?? "(no name)");
  process.exit(0);
}

// 2. Flip the tutorial flag.
const { error: updErr } = await supabase
  .from("profiles")
  .update({ leader_tour_pending: true })
  .in("id", ids);
if (updErr) {
  console.error("Failed to set leader_tour_pending:", updErr.message);
  process.exit(1);
}
console.log(`Flipped leader_tour_pending = true for ${ids.length} leader(s).`);

// 3. Insert notifications. Unique kind so any future dedupe logic
//    targeting role_granted_leader / role_granted_leader_backfill
//    doesn't suppress this one.
const NOTIF_KIND = "leader_tour_refire";
const NOTIF_TITLE = "🎖 Leader tutorial waiting";
const NOTIF_BODY =
  "We refreshed the advocate-leader walkthrough. Open your dashboard to start it (1 min).";
const NOTIF_LINK = "/dashboard";

const { data: insertedNotifs, error: insErr } = await supabase
  .from("notifications")
  .insert(
    ids.map((uid) => ({
      user_id: uid,
      kind: NOTIF_KIND,
      title: NOTIF_TITLE,
      body: NOTIF_BODY,
      link: NOTIF_LINK,
    })),
  )
  .select("id, user_id");
if (insErr) {
  console.error("Failed to insert notifications:", insErr.message);
  process.exit(1);
}
console.log(`Inserted ${insertedNotifs?.length ?? 0} notification row(s).`);

// 4. Push fan-out. Skip if VAPID isn't configured.
if (!pushReady) {
  console.log("VAPID not configured — skipping push fan-out.");
  console.log("Done. Bell icon will update via Realtime; tour fires on next /dashboard load.");
  process.exit(0);
}

const { data: subsRaw } = await supabase
  .from("push_subscriptions")
  .select("id, user_id, endpoint, p256dh, auth")
  .in("user_id", ids);
const subs = subsRaw ?? [];
console.log(`Found ${subs.length} push subscription(s) to deliver to.`);

let sent = 0;
let pruned = 0;
let failed = 0;
const deliveredNotifIds = new Set();

for (const s of subs) {
  const payload = JSON.stringify({
    title: NOTIF_TITLE,
    body: NOTIF_BODY,
    link: NOTIF_LINK,
    tag: NOTIF_KIND,
  });
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
      { TTL: 60 * 60 * 24 },
    );
    sent++;
    // Map subscription -> notification for this user so we can mark
    // pushed_at on the right notification row.
    const notif = (insertedNotifs ?? []).find((n) => n.user_id === s.user_id);
    if (notif) deliveredNotifIds.add(notif.id);
  } catch (e) {
    const err = e;
    const status = err?.statusCode ?? 0;
    if (status === 404 || status === 410) {
      // Subscription is dead — prune.
      await supabase.from("push_subscriptions").delete().eq("id", s.id);
      pruned++;
    } else {
      failed++;
      console.warn(`  push send failed for sub ${s.id}: ${err?.message ?? err}`);
    }
  }
}

// 5. Mark delivered notifications so the cron doesn't re-push.
if (deliveredNotifIds.size > 0) {
  const nowIso = new Date().toISOString();
  await supabase
    .from("notifications")
    .update({ pushed_at: nowIso })
    .in("id", Array.from(deliveredNotifIds));
}

console.log(
  `Push fan-out: sent=${sent}, pruned=${pruned}, failed=${failed}, marked_delivered=${deliveredNotifIds.size}.`,
);
console.log("Done. Tour fires on each leader's next /dashboard load.");
