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

// Paging (2026-11-18, scale prep): one run used to read only the newest 500
// pending rows. A 1,000-member alert is 1,000 rows; worse, rows HELD for
// daily/weekly digests stay pending and kept refilling that window every
// run, starving members who want alerts now. The sweep now pages through
// everything pending, newest first, keyed on (created_at, id) because one
// broadcast insert stamps every row with the same created_at, and stops at
// a time budget so the 30 s Netlify path stays safe.
const PAGE_ROWS = 300;
const IN_CHUNK = 100; // ids per .in() filter; keeps each request URL short
const SEND_CONCURRENCY = 10;
const DEFAULT_BUDGET_MS = 20_000;
const SITE_URL = process.env.APP_URL || "https://www.ikratom.org";
// 10 minutes let every 2-hourly alert run and the morning brief + national
// news (minutes apart, separate runs) each buzz on their own: ~5-6 a day per
// member on 10-27. Two hours folds a morning or a burst into one digest; held
// items stay in the inbox and roll into the next push. Members can still set
// their own interval.
const DEFAULT_MIN_INTERVAL_MIN = 120;

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

/**
 * `opts` narrows a sweep to some users and kinds. `instant` is the lane for a
 * person-to-person event (an @mention): it skips only the batching interval.
 * Opt-outs, quiet hours and daily/weekly digest cadences still hold it, and it
 * leaves the member's other pending rows and `last_push_at` alone, so the
 * regular digest is neither swallowed nor delayed by it.
 */
export type FanoutOptions = {
  userIds?: string[];
  kinds?: string[];
  instant?: boolean;
  /** Stop starting new pages after this long (default 20 s). The GitHub runner passes minutes. */
  budgetMs?: number;
};

export async function fanoutPushNotifications(
  supabase: SupabaseClient,
  opts: FanoutOptions = {},
): Promise<{
  skipped?: string;
  sent?: number;
  failed?: number;
  pruned?: number;
  users?: number;
  coalesced?: number;
  held?: number;
  pages?: number;
  /** True when the time budget ran out with pages left; the next run picks them up. */
  more?: boolean;
}> {
  if (!isPushConfigured()) {
    return { skipped: "VAPID not configured" };
  }

  // Unpushed rows from the last 7 DAYS, NEWEST first. 7 days so a weekly
  // member's held rows survive until their Monday boundary; newest first so
  // fresh instant pushes go before held ones. Opt-out/no-sub rows are stamped
  // on first sweep, so the wide window doesn't resurrect those.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const totals: PageResult = { sent: 0, failed: 0, pruned: 0, coalesced: 0, held: 0 };
  // Each member is decided once per run. A pushed member has ALL pending rows
  // stamped and a held member stays held, so their older rows on later pages
  // are skipped instead of being decided again.
  const decided = new Set<string>();
  let cursor: { at: string; id: string } | null = null;
  let pages = 0;
  let more = false;

  for (;;) {
    if (Date.now() > deadline) { more = true; break; }
    let sweep = supabase
      .from("notifications")
      .select("id, user_id, kind, title, body, link, created_at")
      .is("pushed_at", null)
      .gte("created_at", since);
    if (opts.userIds) sweep = sweep.in("user_id", opts.userIds);
    if (opts.kinds) sweep = sweep.in("kind", opts.kinds);
    if (cursor) {
      sweep = sweep.or(`created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id})`);
    }
    const { data, error } = await sweep
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_ROWS);
    if (error) {
      if (pages === 0) return { skipped: `query failed: ${error.message}` };
      more = true;
      break;
    }
    const rows = (data ?? []) as (Notification & { created_at: string })[];
    if (rows.length === 0) break;
    pages++;
    const last = rows[rows.length - 1];
    cursor = { at: last.created_at, id: last.id };
    const fresh = rows.filter((n) => !decided.has(n.user_id));
    for (const n of rows) decided.add(n.user_id);
    if (fresh.length > 0) {
      const r = await deliverPage(supabase, fresh, opts);
      totals.sent += r.sent;
      totals.failed += r.failed;
      totals.pruned += r.pruned;
      totals.coalesced += r.coalesced;
      totals.held += r.held;
    }
    if (rows.length < PAGE_ROWS) break;
  }

  // push_send_log retention: held outcomes log every hourly run, keep 30 days.
  if (pages > 0) {
    try {
      await supabase.from("push_send_log").delete().lt("run_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    } catch { /* best-effort */ }
  }

  return { ...totals, users: decided.size, pages, more };
}

type PageResult = { sent: number; failed: number; pruned: number; coalesced: number; held: number };

/** Run a select once per IN_CHUNK ids and join the rows. */
async function selectIn<R>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: unknown[] | null }>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data } = await run(ids.slice(i, i + IN_CHUNK));
    out.push(...((data ?? []) as R[]));
  }
  return out;
}

async function eachChunk(ids: string[], run: (chunk: string[]) => PromiseLike<unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += IN_CHUNK) await run(ids.slice(i, i + IN_CHUNK));
}

/** Decide, send and stamp one page of pending rows (members not yet decided this run). */
async function deliverPage(
  supabase: SupabaseClient,
  notifs: Notification[],
  opts: FanoutOptions,
): Promise<PageResult> {
  const userIds = Array.from(new Set(notifs.map((n) => n.user_id)));

  const subsRaw = await selectIn<Subscription & { user_id: string }>(userIds, (c) =>
    supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", c));
  const subsByUser = new Map<string, Subscription[]>();
  for (const s of subsRaw) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  // Preferences (opt-out + throttle state)
  const prefsRaw = await selectIn<Prefs>(userIds, (c) =>
    supabase
      .from("notification_preferences")
      .select("user_id, in_app, digest, push_min_interval_minutes, last_push_at, dnd_enabled, quiet_hours_start, quiet_hours_end, timezone")
      .in("user_id", c));
  const prefsByUser = new Map<string, Prefs>();
  for (const p of prefsRaw) prefsByUser.set(p.user_id, p);

  // Group pending notifications per user, oldest-first within each user
  // (the sweep itself is newest-first; reverse per group).
  const byUser = new Map<string, Notification[]>();
  for (const n of notifs) {
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
    byUser.get(n.user_id)!.push(n);
  }
  for (const list of byUser.values()) list.reverse();

  const now = Date.now();
  const r: PageResult = { sent: 0, failed: 0, pruned: 0, coalesced: 0, held: 0 };
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

  const toSend: Array<{
    uid: string;
    subs: Subscription[];
    notifs: Notification[];
    payload: { title: string; body: string; link: string; tag?: string };
  }> = [];

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
      r.held += userNotifs.length;
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
      r.held += userNotifs.length;
      logRow(uid, "held_digest", userNotifs.length, subs.length);
      continue;
    }

    // Rate-cap: if pushed within the per-user interval, HOLD this user's
    // notifications (leave unpushed → roll into the next allowed digest).
    const minIntervalMs =
      (prefs?.push_min_interval_minutes ?? DEFAULT_MIN_INTERVAL_MIN) * 60_000;
    const last = prefs?.last_push_at ? new Date(prefs.last_push_at).getTime() : 0;
    if (!opts.instant && last && now - last < minIntervalMs) {
      r.held += userNotifs.length;
      logRow(uid, "held_rate", userNotifs.length, subs.length);
      continue;
    }

    // Build ONE payload: single notification verbatim, or a digest for 2+.
    if (userNotifs.length === 1) {
      const n = userNotifs[0];
      toSend.push({ uid, subs, notifs: userNotifs, payload: { title: n.title, body: n.body ?? "", link: resolveLink(n.link), tag: n.kind ?? undefined } });
    } else {
      const newest = userNotifs[userNotifs.length - 1];
      toSend.push({
        uid,
        subs,
        notifs: userNotifs,
        payload: {
          title: `${userNotifs.length} new updates`,
          body: `${newest.title} + ${userNotifs.length - 1} more`,
          link: `${SITE_URL}/notifications`,
          tag: "digest",
        },
      });
      r.coalesced++;
    }
  }

  // Send SEND_CONCURRENCY members at a time; each member's devices in turn.
  for (let i = 0; i < toSend.length; i += SEND_CONCURRENCY) {
    await Promise.all(toSend.slice(i, i + SEND_CONCURRENCY).map(async (t) => {
      let anyOk = false;
      let userFailed = 0;
      let lastErr: string | null = null;
      for (const sub of t.subs) {
        const res = await sendPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          t.payload,
        );
        if (res.ok) anyOk = true;
        else if (!res.ok && res.gone) deadSubIds.push(sub.id);
        else { r.failed++; userFailed++; lastErr = ("error" in res ? String(res.error) : "send failed").slice(0, 200); }
      }
      if (anyOk) r.sent++;
      deliveredIds.push(...t.notifs.map((n) => n.id));
      pushedUserIds.push(t.uid);
      if (!anyOk && userFailed === 0) lastErr = "all subscriptions gone (pruned)";
      logRow(t.uid, anyOk ? "sent" : "error", t.notifs.length, t.subs.length, anyOk ? 1 : 0, userFailed, lastErr);
    }));
  }

  const stampedAt = new Date().toISOString();
  // Mark delivered notifications pushed (incl. opt-out / no-sub, to skip next run)
  await eachChunk(deliveredIds, (c) =>
    supabase.from("notifications").update({ pushed_at: stampedAt }).in("id", c));

  if (pushedUserIds.length > 0 && !opts.instant) {
    // A push "covers" EVERYTHING the user had pending — also stamp their
    // out-of-page rows (a digest user can hold more than one page carries;
    // without this they'd re-buzz at the next boundary).
    await eachChunk(pushedUserIds, (c) =>
      supabase.from("notifications").update({ pushed_at: stampedAt }).in("user_id", c).is("pushed_at", null));
    // Stamp last_push_at for users we actually pushed (drives the rate-cap
    // AND the digest boundary marker)
    await eachChunk(pushedUserIds, (c) =>
      supabase.from("notification_preferences").update({ last_push_at: stampedAt }).in("user_id", c));
  }

  // Prune dead subscriptions
  if (deadSubIds.length > 0) {
    await eachChunk(deadSubIds, (c) => supabase.from("push_subscriptions").delete().in("id", c));
    r.pruned = deadSubIds.length;
  }

  // Delivery telemetry — best-effort; tolerates 0194 not being applied yet.
  if (sendLog.length > 0) {
    try { await supabase.from("push_send_log").insert(sendLog); } catch { /* best-effort */ }
  }

  return r;
}
