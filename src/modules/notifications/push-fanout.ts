import { sendPush, isPushConfigured } from "@/lib/push/send";
import { canPushUser, digestDue } from "@/lib/notifications/push-gate";
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

  // Pull unpushed notifications from the last 7 DAYS, NEWEST first. Was 24h
  // oldest-first; widened for digest cadences (a weekly user's held rows must
  // survive until their Monday boundary) — and flipped to newest-first so
  // held-by-design digest/DND rows can never pin the LIMIT window and starve
  // fresh instant pushes. Per-user delivery covers out-of-batch rows anyway:
  // a pushed user has ALL their pending rows stamped (see below). Opt-out/
  // no-sub rows are stamped on first sweep, so the wider window doesn't
  // resurrect those.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: notifsRaw, error: notifsErr } = await supabase
    .from("notifications")
    .select("id, user_id, kind, title, body, link")
    .is("pushed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
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

  // Group pending notifications per user, oldest-first within each user
  // (the sweep itself is newest-first; reverse per group).
  const byUser = new Map<string, Notification[]>();
  for (const n of notifs) {
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
    byUser.get(n.user_id)!.push(n);
  }
  for (const list of byUser.values()) list.reverse();

  const now = Date.now();
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  let coalesced = 0;
  let held = 0;
  const deliveredIds: string[] = [];
  const deadSubIds: string[] = [];
  const pushedUserIds: string[] = [];
  // Per-user delivery telemetry (push_send_log, 0194) — the answer to
  // "why didn't I get notified?". Best-effort batch insert at the end.
  const sendLog: Array<{
    user_id: string; outcome: string; notification_count: number;
    subscription_count: number; sent_count: number; failed_count: number; error: string | null;
  }> = [];
  const logRow = (uid: string, outcome: string, n: number, subs: number, ok = 0, bad = 0, err: string | null = null) =>
    sendLog.push({ user_id: uid, outcome, notification_count: n, subscription_count: subs, sent_count: ok, failed_count: bad, error: err });

  const resolveLink = (link: string | null) =>
    link ? (link.startsWith("http") ? link : new URL(link, SITE_URL).href) : `${SITE_URL}/notifications`;

  for (const [uid, userNotifs] of byUser) {
    const prefs = prefsByUser.get(uid);
    const subCount = (subsByUser.get(uid) ?? []).length;

    // Opt-out → mark delivered (skip next run), never send.
    if (prefs && (prefs.in_app === false || prefs.digest === "off")) {
      deliveredIds.push(...userNotifs.map((n) => n.id));
      logRow(uid, "opt_out", userNotifs.length, subCount);
      continue;
    }

    // DND / quiet hours → HOLD (leave unpushed so it rolls into the next
    // allowed window). The in-app notification still sits in the inbox.
    if (prefs && !canPushUser(prefs, now)) {
      held += userNotifs.length;
      logRow(uid, "held_dnd", userNotifs.length, subCount);
      continue;
    }

    // No push target → mark delivered BEFORE any digest hold (holding rows
    // for a user we could never push is a pointless 7-day loop).
    const subs = subsByUser.get(uid) ?? [];
    if (subs.length === 0) {
      deliveredIds.push(...userNotifs.map((n) => n.id));
      logRow(uid, "no_subs", userNotifs.length, 0);
      continue;
    }

    // Digest cadence (PR-J): daily/weekly users push once per 9am-local
    // boundary (Monday for weekly) → HOLD until due. Boundary semantics
    // mean quiet hours / rate-caps over 9am only DELAY delivery to the
    // next allowed hour, never skip a digest. Held rows accumulate and
    // coalesce into ONE digest push when due.
    if (prefs && !digestDue(prefs, now)) {
      held += userNotifs.length;
      logRow(uid, "held_digest", userNotifs.length, subs.length);
      continue;
    }

    // Rate-cap: if pushed within the per-user interval, HOLD this user's
    // notifications (leave unpushed → roll into the next allowed digest).
    const minIntervalMs =
      (prefs?.push_min_interval_minutes ?? DEFAULT_MIN_INTERVAL_MIN) * 60_000;
    const last = prefs?.last_push_at ? new Date(prefs.last_push_at).getTime() : 0;
    if (last && now - last < minIntervalMs) {
      held += userNotifs.length;
      logRow(uid, "held_rate", userNotifs.length, subs.length);
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
    let userFailed = 0;
    let lastErr: string | null = null;
    for (const sub of subs) {
      const r = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      if (r.ok) anyOk = true;
      else if (!r.ok && r.gone) deadSubIds.push(sub.id);
      else { failed++; userFailed++; lastErr = ("error" in r ? String(r.error) : "send failed").slice(0, 200); }
    }
    if (anyOk) sent++;
    deliveredIds.push(...userNotifs.map((n) => n.id));
    pushedUserIds.push(uid);
    if (!anyOk && userFailed === 0) lastErr = "all subscriptions gone (pruned)";
    logRow(uid, anyOk ? "sent" : "error", userNotifs.length, subs.length, anyOk ? 1 : 0, userFailed, lastErr);
  }

  // Mark delivered notifications pushed (incl. opt-out / no-sub, to skip next run)
  if (deliveredIds.length > 0) {
    await supabase
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", deliveredIds);
  }

  // A push "covers" EVERYTHING the user had pending — also stamp their
  // out-of-batch rows (a digest user can hold more than the sweep window
  // carried; without this they'd re-buzz at the next boundary).
  if (pushedUserIds.length > 0) {
    await supabase
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("user_id", pushedUserIds)
      .is("pushed_at", null);
  }

  // Stamp last_push_at for users we actually pushed (drives the rate-cap
  // AND the digest boundary marker)
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

  // Delivery telemetry — best-effort; tolerates 0194 not being applied yet.
  if (sendLog.length > 0) {
    try {
      await supabase.from("push_send_log").insert(sendLog);
      // Retention: held outcomes log every hourly run — cap at 30 days.
      await supabase.from("push_send_log").delete().lt("run_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    } catch { /* best-effort */ }
  }

  return { sent, failed, pruned, users: byUser.size, coalesced, held };
}
