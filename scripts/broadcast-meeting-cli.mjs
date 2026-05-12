#!/usr/bin/env node
/**
 * CLI-callable broadcast for a municipal_meetings row.
 *
 * Same effect as clicking "📢 Broadcast NOW" on /admin/meetings —
 * fans out push + in-app notif to all in-state users and creates a
 * critical /pulse alert.
 *
 * Provided as a CLI so admin can fire from the command line when
 * minutes matter (e.g. meeting already in progress, no time for
 * page nav + button click + confirm prompt).
 *
 * Run:
 *   node --env-file=.env.local scripts/broadcast-meeting-cli.mjs <meeting-id>
 *   node --env-file=.env.local scripts/broadcast-meeting-cli.mjs <meeting-id> --force
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (already in env).
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const MEETING_ID = args.find((a) => /^[0-9a-f-]{36}$/i.test(a));
const FORCE = args.includes("--force");

if (!MEETING_ID) {
  console.error("Usage: <meeting-id-uuid> [--force]");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ---------- 1. Read the meeting ----------
const { data: meeting, error: readErr } = await sb
  .from("municipal_meetings")
  .select("*")
  .eq("id", MEETING_ID)
  .single();
if (readErr || !meeting) {
  console.error(`Meeting ${MEETING_ID} not found:`, readErr?.message);
  process.exit(1);
}
if (meeting.moderation_status !== "approved") {
  console.error(`Meeting status is "${meeting.moderation_status}" — must be approved to broadcast.`);
  process.exit(1);
}
if (meeting.broadcast_at && !FORCE) {
  console.error(`Already broadcast at ${meeting.broadcast_at} to ${meeting.broadcast_recipient_count} users.`);
  console.error(`Use --force to re-broadcast.`);
  process.exit(1);
}

console.log(`\n📢 Broadcasting meeting:`);
console.log(`   ${meeting.locality ?? meeting.state} · ${meeting.body_name ?? "meeting"}`);
console.log(`   ${meeting.meeting_at}`);
console.log(`   livestream: ${meeting.livestream_url ?? "(none)"}`);
console.log(`   zoom: ${meeting.zoom_url ?? "(none)"}`);

// ---------- 2. Find in-state users ----------
const { data: targetUsers } = await sb
  .from("profiles")
  .select("id")
  .eq("state", meeting.state)
  .limit(50_000);
const userIds = (targetUsers ?? []).map((u) => u.id);
console.log(`\n   Target users in ${meeting.state}: ${userIds.length}`);

// ---------- 3. Compose payload ----------
const when = new Date(meeting.meeting_at);
const title = `🚨 LIVE NOW: ${meeting.locality ?? meeting.state} ${meeting.body_name ?? "meeting"}`;
const body = meeting.zoom_url || meeting.livestream_url
  ? `Kratom is on the agenda. Watch the livestream now.`
  : `Kratom is on the agenda. Tap for details.`;
const link = `/meetings/${meeting.id}`;

// ---------- 4. In-app notifications ----------
if (userIds.length > 0) {
  const rows = userIds.map((uid) => ({
    user_id: uid,
    kind: "meeting_live",
    title,
    body,
    link,
  }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error, count } = await sb
      .from("notifications")
      .insert(chunk, { count: "exact" });
    if (error) console.log(`   notification chunk failed: ${error.message}`);
    else inserted += count ?? chunk.length;
  }
  console.log(`   In-app notifications inserted: ${inserted}`);
}

// ---------- 5. Push fanout ----------
let pushSent = 0;
let pushGone = [];
if (userIds.length > 0) {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@ikratom.org";
  if (pub && priv) {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(subject, pub, priv);
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds)
      .limit(10_000);
    const payload = JSON.stringify({ title, body, link, tag: `meeting-${meeting.id}` });
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 6 * 60 * 60 },
        );
        pushSent++;
      } catch (e) {
        const status = e?.statusCode ?? 0;
        if (status === 404 || status === 410) pushGone.push(s.id);
      }
    }
    if (pushGone.length > 0) {
      await sb.from("push_subscriptions").delete().in("id", pushGone);
    }
    console.log(`   Web push sent: ${pushSent} (${pushGone.length} dead subs pruned)`);
  } else {
    console.log(`   Web push skipped: VAPID env not configured`);
  }
}

// ---------- 6. Critical /pulse alert ----------
const alertBody =
  `Live meeting in ${meeting.locality ?? meeting.state}: kratom is on the agenda right now.\n\n` +
  (meeting.zoom_url ? `**Join Zoom:** ${meeting.zoom_url}\n\n` : "") +
  (meeting.livestream_url ? `**Watch livestream:** ${meeting.livestream_url}\n\n` : "") +
  (meeting.agenda_url ? `**Agenda:** ${meeting.agenda_url}\n\n` : "") +
  (meeting.in_person_address ? `**In person:** ${meeting.in_person_address}\n\n` : "") +
  (meeting.public_comment_signup_url ? `**Sign up to speak:** ${meeting.public_comment_signup_url}\n\n` : "") +
  (meeting.agenda_text ? `\n_Agenda excerpt:_\n${meeting.agenda_text.slice(0, 500)}\n\n` : "") +
  `**Detail page (shareable):** ${process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org"}/meetings/${meeting.id}`;

const { error: alertErr } = await sb.from("policy_alerts").insert({
  kind: "bop_hearing",
  severity: "critical",
  title: `🚨 LIVE: ${meeting.locality ?? meeting.state} ${meeting.body_name ?? "meeting"} — kratom on agenda`,
  body: alertBody,
  locality: meeting.state,
  source_url: meeting.livestream_url ?? meeting.zoom_url ?? meeting.agenda_url ?? meeting.source_url,
  occurs_at: when.toISOString(),
  expires_at: new Date(when.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  action_required: true,
  moderation_status: "approved",
});
if (alertErr) {
  console.log(`   ✗ policy_alert insert: ${alertErr.message}`);
} else {
  console.log(`   ✓ /pulse critical alert created`);
}

// ---------- 7. Stamp the meeting ----------
await sb.from("municipal_meetings").update({
  broadcast_at: new Date().toISOString(),
  broadcast_recipient_count: userIds.length,
}).eq("id", MEETING_ID);

console.log(`\n✅ Broadcast complete.`);
console.log(`   Shareable URL: ${process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org"}/meetings/${meeting.id}`);
process.exit(0);
