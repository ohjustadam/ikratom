import { sendPush, isPushConfigured } from "@/lib/push/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sweep recently-created notifications and deliver each to every push
 * subscription owned by the recipient. Caller must pass a SERVICE-ROLE
 * Supabase client — this runs in cron context where there is no logged-in
 * user, and we need to read across `notifications` + `push_subscriptions`
 * regardless of RLS.
 *
 * Notifications older than 24 hours are skipped to avoid flooding users
 * with stale alerts after a long outage / cron pause.
 *
 * Subscriptions returning 404/410 are deleted (browser unsubscribed or
 * uninstalled the app) so we don't burn requests on dead endpoints.
 */

const MAX_PER_RUN = 500;
const SITE_URL = process.env.APP_URL || "https://ikratom.app";

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

export async function fanoutPushNotifications(
  supabase: SupabaseClient,
): Promise<{ skipped?: string; sent?: number; failed?: number; pruned?: number; users?: number }> {
  if (!isPushConfigured()) {
    return { skipped: "VAPID not configured" };
  }

  // Pull unpushed notifications from the last 24 hours
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
  if (notifs.length === 0) return { sent: 0, failed: 0, pruned: 0, users: 0 };

  // Pull this batch's recipients' subscriptions in one round-trip
  const userIds = Array.from(new Set(notifs.map((n) => n.user_id)));
  const { data: subsRaw } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  const subsByUser = new Map<string, Subscription[]>();
  for (const s of (subsRaw ?? []) as (Subscription & { user_id: string })[]) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  // Also honor users' in-app preference: if `in_app` is false they didn't
  // ask for push surfacing. (Web push IS in-app on web.)
  const { data: prefsRaw } = await supabase
    .from("notification_preferences")
    .select("user_id, in_app")
    .in("user_id", userIds);
  const inAppOff = new Set(
    ((prefsRaw ?? []) as { user_id: string; in_app: boolean }[])
      .filter((p) => p.in_app === false)
      .map((p) => p.user_id),
  );

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const deliveredIds: string[] = [];
  const deadSubIds: string[] = [];

  for (const n of notifs) {
    if (inAppOff.has(n.user_id)) {
      // Mark as "pushed" anyway so we don't keep retrying — the user opted out.
      deliveredIds.push(n.id);
      continue;
    }
    const subs = subsByUser.get(n.user_id) ?? [];
    if (subs.length === 0) {
      // No subscriptions = no push possible. Mark pushed so we skip next run.
      deliveredIds.push(n.id);
      continue;
    }
    const link = n.link
      ? n.link.startsWith("http")
        ? n.link
        : new URL(n.link, SITE_URL).href
      : `${SITE_URL}/notifications`;
    const payload = {
      title: n.title,
      body: n.body ?? "",
      link,
      tag: n.kind ?? undefined,
    };

    let anyOk = false;
    for (const sub of subs) {
      const r = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      if (r.ok) {
        anyOk = true;
      } else if (!r.ok && r.gone) {
        deadSubIds.push(sub.id);
      } else {
        failed++;
      }
    }
    if (anyOk) sent++;
    deliveredIds.push(n.id);
  }

  // Mark batch as pushed (even rows that had no subs / opt-out, to skip next run)
  if (deliveredIds.length > 0) {
    await supabase
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", deliveredIds);
  }

  // Prune dead subscriptions
  if (deadSubIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", deadSubIds);
    pruned = deadSubIds.length;
  }

  return { sent, failed, pruned, users: userIds.length };
}
