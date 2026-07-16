#!/usr/bin/env node
/**
 * send-service-notice.mjs — one-shot service/outage notice to ALL users.
 *
 * Born 2026-07-16 (egress-restriction incident, owner ask: "put up an emergency
 * note … send a notification about it to everyone"). Follows the post-#816
 * delivery discipline for instant sends:
 *   - INSERTS a notifications row per user (kind='service_notice' — an
 *     uncategorized kind, so the 0194 category gate never drops it) → inbox
 *     history for everyone, including users with no push subscription.
 *   - Direct web-push ONLY to users who allow push (skips in_app=false /
 *     digest='off') and are not in DND/quiet-hours (held users keep
 *     pushed_at=NULL so the hourly fan-out delivers them later).
 *   - Stamps pushed_at + last_push_at for users actually pushed → the fan-out
 *     will NOT re-buzz them (no double-buzz).
 *   - tag='service-notice' → a follow-up notice REPLACES the prior one on the
 *     device instead of stacking.
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-service-notice.mjs --dry-run \
 *     --title "..." --body "..." [--link /status]
 *   node --env-file=.env.local scripts/send-service-notice.mjs --apply --title ... --body ...
 */
import { createClient } from "@supabase/supabase-js";
import { canPushUser } from "./lib/push-gate.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const TITLE = arg("--title");
const BODY = arg("--body");
const LINK = arg("--link") || "/";
if (!TITLE || !BODY) { console.error("Required: --title and --body"); process.exit(1); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: users, error: uErr } = await sb.from("profiles").select("id").limit(50000);
if (uErr) { console.error("profiles read failed:", uErr.message); process.exit(1); }
const userIds = (users ?? []).map((u) => u.id);

const { data: prefsRows } = await sb
  .from("notification_preferences")
  .select("user_id, in_app, digest, dnd_enabled, quiet_hours_start, quiet_hours_end, timezone")
  .in("user_id", userIds);
const prefs = new Map((prefsRows ?? []).map((p) => [p.user_id, p]));

const { data: subs } = await sb
  .from("push_subscriptions")
  .select("id, user_id, endpoint, p256dh, auth")
  .in("user_id", userIds)
  .limit(10000);

console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — ${userIds.length} users, ${(subs ?? []).length} push subscriptions`);
console.log(`  title: ${TITLE}\n  body:  ${BODY}\n  link:  ${LINK}`);
if (!APPLY) { console.log("\n(dry run — nothing sent; re-run with --apply)"); process.exit(0); }

// 1. Inbox rows for everyone (history trail; category gate never drops 'service_notice')
const rows = userIds.map((uid) => ({ user_id: uid, kind: "service_notice", title: TITLE, body: BODY, link: LINK }));
for (let i = 0; i < rows.length; i += 200) {
  const { error } = await sb.from("notifications").insert(rows.slice(i, i + 200));
  if (error) console.log(`  ✗ insert chunk: ${error.message?.slice(0, 100)}`);
}
console.log(`  ✓ ${rows.length} inbox notifications inserted`);

// 2. Direct push — opt-out + DND respected; held users delivered later by the fan-out
const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
let sent = 0, held = 0, optedOut = 0, gone = [];
const pushedUsers = new Set();
if (pub && priv) {
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:noreply@ikratom.org", pub, priv);
  const payload = JSON.stringify({ title: TITLE, body: BODY, link: LINK, tag: "service-notice" });
  const now = Date.now();
  for (const s of subs ?? []) {
    const p = prefs.get(s.user_id);
    if (p && (p.in_app === false || p.digest === "off")) { optedOut++; continue; }
    if (!canPushUser(p, now)) { held++; continue; }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
      sent++; pushedUsers.add(s.user_id);
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.id);
    }
  }
  if (gone.length) await sb.from("push_subscriptions").delete().in("id", gone);
  if (pushedUsers.size) {
    const ids = [...pushedUsers];
    const now2 = new Date().toISOString();
    await sb.from("notifications").update({ pushed_at: now2 }).in("user_id", ids).eq("kind", "service_notice").is("pushed_at", null);
    await sb.from("notification_preferences").update({ last_push_at: now2 }).in("user_id", ids);
  }
} else console.log("  (VAPID not set — inbox only)");

console.log(`  ✓ push: ${sent} sent · ${held} held (DND/quiet → fan-out later) · ${optedOut} opted out · ${gone.length} dead subs pruned`);
try {
  await sb.from("scraper_runs").insert({
    source: "send_service_notice", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    status: "success", rows_added: rows.length, notes: `push ${sent}/${(subs ?? []).length}, "${TITLE.slice(0, 80)}"`,
  });
} catch { /* best-effort */ }
