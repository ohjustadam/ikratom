import { sendPush, isPushConfigured } from "@/lib/push/send";
import { canPushUser } from "@/lib/notifications/push-gate";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sweep recently-created notifications and deliver them as push, with a
 * built-in ANTI-SPAM safeguard so a user is never overrun:
 *
 *  1. COALESCE — all of a user's pending notifications in a single run are
 *     collapsed into ONE push. 1 pending → that notification; 2+ pending →
 *     a digest ("N new updates: <newest> + N more") linking to /notifications,
 *     with a fixed `digest` tag so it replaces (not stacks) on the device.
 *  2. RATE-CAP — a user is not pushed again until `push_min_interval_minutes`
 *     has elapsed since their `last_push_at`. Held notifications stay unpushed
 *     (still visible in the inbox) and roll into the next allowed digest.
 *  3. OPT-OUT — `in_app=false` or `digest='off'` suppress push entirely.
 *
 * So even a legitimate burst (e.g. a legislative dump that creates 40 alerts)
 * results in at most one buzz per user per interval. Caller passes a
 * SERVICE-ROLE client (cron context, reads across notifications + subs + prefs
 * regardless of RLS). Notifications older than 24h are skipped (stale).
 * Subscriptions returning 404/410 are pruned.
 */

const MAX_PER_RUN = 500;
const SITE_URL = process.env.APP_URL || "https://www.ikratom.org";
const DEFAULT_MIN_INTERVAL_MIN = 10;

type Notification = {
  id: string;
  user_id: string;
  kind: string | null;
  title: string;
  body: string | null;
  link: string | null;
};

type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type Prefs = {
  user_id: string;
  in_app: boolean | null;
  digest: string | null;
  push_min_interval_minutes: number | null;
  last_push_at: string | null;
  dnd_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
};

export async function fanoutPushNotifications(
  supabase: SupabaseClient,
): Promise<{
  skipped?: string;
  sent?: number;
  failed?: number;
  pruned?: number;
  users?: number;
  coalesced?: number;
  held?: number;
}> {
  if (!isPushConfigured()) {
    return { skipped: "VAPID not configured" };
  }

  // Pull unpushed notifications from the last 24 hours (oldest first)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: notifsRaw, error: notifsErr } = await supabase
    .from("notifications")
    .select("id, user_id, kind, title, body, link")
    .is("pushed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (notifsErr) return { skipped: `query failed: ${notifsErr.message}` };
  const notifs = (notifsRaw ?? []) as Notification[];
  if (notifs.length === 0) return { sent: 0, failed: 0, pruned: 0, users: 0, coalesced: 0, held: 0 };

  const userIds = Array.from(new Set(notifs.map((n) => n.user_id)));

  // Subscriptions for this batch's recipients
  const { data: subsRaw } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  const subsByUser = new Map<string, Subscription[]>();
  for (const s of (subsRaw ?? []) as (Subscription & { user_id: string })[]) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  // Preferences (opt-out + throttle state)
  const { data: prefsRaw } = await supabase
    .from("notification_preferences")
    .select(
      "user_id, in_app, digest, push_min_interval_minutes, last_push_at, dnd_enabled, quiet_hours_start, quiet_hours_end, timezone",
    )
    .in("user_id", userIds);
  const prefsByUser = new Map<string, Prefs>();
  for (const p of (prefsRaw ?? []) as Prefs[]) prefsByUser.set(p.user_id, p);

  // Group pending notifications per user (already oldest-first)
  const byUser = new Map<string, Notification[]>();
  for (const n of notifs) {
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
    byUser.get(n.user_id)!.push(n);
  }

  const now = Date.now();
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  let coalesced = 0;
  let held = 0;
  const deliveredIds: string[] = [];
  const deadSubIds: string[] = [];
  const pushedUserIds: string[] = [];

  const resolveLink = (link: string | null) =>
    link ? (link.startsWith("http") ? link : new URL(link, SITE_URL).href) : `${SITE_URL}/notifications`;

  for (const [uid, userNotifs] of byUser) {
    const prefs = prefsByUser.get(uid);

    // Opt-out → mark delivered (skip next run), never send.
    if (prefs && (prefs.in_app === false || prefs.digest === "off")) {
      deliveredIds.push(...userNotifs.map((n) => n.id));
      continue;
    }

    // DND / quiet hours → HOLD (leave unpushed so it rolls into the next
    // allowed window). The in-app notification still sits in the inbox.
    if (prefs && !canPushUser(prefs, now)) {
      held += userNotifs.length;
      continue;
    }

    const subs = subsByUser.get(uid) ?? [];
    if (subs.length === 0) {
      deliveredIds.push(...userNotifs.map((n) => n.id));
      continue;
    }

    // Rate-cap: if pushed within the per-user interval, HOLD this user's
    // notifications (leave unpushed → roll into the next allowed digest).
    const minIntervalMs =
      (prefs?.push_min_interval_minutes ?? DEFAULT_MIN_INTERVAL_MIN) * 60_000;
    const last = prefs?.last_push_at ? new Date(prefs.last_push_at).getTime() : 0;
    if (last && now - last < minIntervalMs) {
      held += userNotifs.length;
      continue;
    }

    // Build ONE payload: single notification verbatim, or a digest for 2+.
    let payload: { title: string; body: string; link: string; tag?: string };
    if (userNotifs.length === 1) {
      const n = userNotifs[0];
      payload = { title: n.title, body: n.body ?? "", link: resolveLink(n.link), tag: n.kind ?? undefined };
    } else {
      const newest = userNotifs[userNotifs.length - 1];
      payload = {
        title: `${userNotifs.length} new updates`,
        body: `${newest.title} + ${userNotifs.length - 1} more`,
        link: `${SITE_URL}/notifications`,
        tag: "digest",
      };
      coalesced++;
    }

    let anyOk = false;
    for (const sub of subs) {
      const r = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      if (r.ok) anyOk = true;
      else if (!r.ok && r.gone) deadSubIds.push(sub.id);
      else failed++;
    }
    if (anyOk) sent++;
    deliveredIds.push(...userNotifs.map((n) => n.id));
    pushedUserIds.push(uid);
  }

  // Mark delivered notifications pushed (incl. opt-out / no-sub, to skip next run)
  if (deliveredIds.length > 0) {
    await supabase
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", deliveredIds);
  }

  // Stamp last_push_at for users we actually pushed (drives the rate-cap)
  if (pushedUserIds.length > 0) {
    await supabase
      .from("notification_preferences")
      .update({ last_push_at: new Date().toISOString() })
      .in("user_id", pushedUserIds);
  }

  // Prune dead subscriptions
  if (deadSubIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", deadSubIds);
    pruned = deadSubIds.length;
  }

  return { sent, failed, pruned, users: byUser.size, coalesced, held };
}
