#!/usr/bin/env node
/**
 * fire-daily-brief-push.mjs — opt-in daily brief web-push.
 *
 * For every user with `notification_preferences.daily_brief_push = true`
 * AND at least one active `push_subscriptions` row, compute a tiny
 * digest preview ("3 alerts in OK + 2 watched bills moved") and fire a
 * single web-push notification per device. Tap-action deep-links to
 * /brief.
 *
 * Runs daily via cron-daily.yml at ~13:00 UTC (~8am ET). Idempotent
 * via `tag: "daily-brief"` — subsequent pushes replace prior brief on
 * the user's device rather than stacking.
 *
 * Cost: $0. web-push is free; payload is <4kb.
 *
 * Usage:
 *   node --env-file=.env.local scripts/fire-daily-brief-push.mjs
 *   node --env-file=.env.local scripts/fire-daily-brief-push.mjs --dry-run
 *   node --env-file=.env.local scripts/fire-daily-brief-push.mjs --user <user_id>
 */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const ONLY_USER = arg("--user");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const VAPID_PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@ikratom.org";
const APP_URL = process.env.APP_URL || "https://www.ikratom.org";

if (!VAPID_PUB || !VAPID_PRIV) {
  // Missing VAPID is "we can't push today," not a workflow failure.
  // Exit 0 so the GH Actions job stays green; staleness alert covers
  // the case where this script gets skipped for too many days.
  console.log("VAPID env vars not set in this env — skipping push delivery (exit 0).");
  process.exit(0);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}

async function getDigestForUser(userId, userState) {
  const cutoff7 = isoDaysAgo(7);
  const cutoff7Date = cutoff7.slice(0, 10);
  const cutoff30Date = isoDaysAgo(30).slice(0, 10);
  // News freshness window: only PUBLISHED in last 36h. The 36h
  // window (vs strict 24h) accommodates time-zone variance + late-
  // night publishing so a user on the West Coast doesn't miss
  // articles published at 1am UTC that landed in our nightly sweep.
  // CRITICAL: filter by `published_at`, NOT `scraped_at` — Google
  // News RSS regularly surfaces 6-month-old articles whose URL was
  // newly re-indexed. Those would otherwise pollute the briefing.
  const cutoff36hPubDate = isoDaysAgo(1.5).slice(0, 10);

  // State alerts (critical + alert)
  let alertsQuery = sb.from("policy_alerts")
    .select("id, severity")
    .in("severity", ["critical", "alert"])
    .eq("moderation_status", "approved")
    .gte("created_at", cutoff7);
  if (userState) alertsQuery = alertsQuery.eq("locality", userState);
  const { data: alerts } = await alertsQuery;
  const alertCount = (alerts ?? []).length;
  const criticalCount = (alerts ?? []).filter((a) => a.severity === "critical").length;

  // Fresh news — published in last 36h, classified as kratom-relevant,
  // matching user's state OR national/federal. Caps at 50 to keep the
  // count meaningful (anything past that = "lots").
  let newsQuery = sb.from("news_items")
    .select("id", { count: "exact", head: true })
    .gte("published_at", cutoff36hPubDate)
    .not("policy_classified_at", "is", null);
  if (userState) newsQuery = newsQuery.or(`state.eq.${userState},state.is.null,state.eq.FED`);
  const { count: rawNewsCount } = await newsQuery;
  const newsCount = Math.min(50, rawNewsCount ?? 0);

  // Watched bills with movement
  let watchedCount = 0;
  try {
    const { data: subs } = await sb
      .from("bill_subscriptions")
      .select("bill_id")
      .eq("user_id", userId);
    const billIds = (subs ?? []).map((s) => s.bill_id);
    if (billIds.length > 0) {
      const { count } = await sb
        .from("bills")
        .select("id", { count: "exact", head: true })
        .in("id", billIds)
        .gte("last_action_at", cutoff7Date);
      watchedCount = count ?? 0;
    }
  } catch { /* table may not exist on legacy deploys */ }

  // Active ops in state
  let activeOpsCount = 0;
  try {
    let opsQuery = sb.from("bill_cluster_members")
      .select("bill_clusters!inner(slug), bills!inner(state, last_action_at, active)")
      .eq("bills.active", true)
      .gte("bills.last_action_at", cutoff30Date);
    if (userState) opsQuery = opsQuery.eq("bills.state", userState);
    const { data } = await opsQuery;
    const slugs = new Set();
    for (const r of data ?? []) {
      const cl = Array.isArray(r.bill_clusters) ? r.bill_clusters[0] : r.bill_clusters;
      if (cl?.slug) slugs.add(cl.slug);
    }
    activeOpsCount = slugs.size;
  } catch { /* defensive */ }

  return { alertCount, criticalCount, watchedCount, activeOpsCount, newsCount };
}

function buildPayload(digest, userState) {
  const lines = [];
  if (digest.criticalCount > 0) lines.push(`🚨 ${digest.criticalCount} critical alert${digest.criticalCount === 1 ? "" : "s"}`);
  if (digest.alertCount > digest.criticalCount) lines.push(`⚠️ ${digest.alertCount - digest.criticalCount} alert${digest.alertCount - digest.criticalCount === 1 ? "" : "s"}`);
  if (digest.newsCount > 0) lines.push(`🗞 ${digest.newsCount}${digest.newsCount === 50 ? "+" : ""} new article${digest.newsCount === 1 ? "" : "s"}`);
  if (digest.watchedCount > 0) lines.push(`📋 ${digest.watchedCount} watched bill${digest.watchedCount === 1 ? "" : "s"} moved`);
  if (digest.activeOpsCount > 0) lines.push(`🕸 ${digest.activeOpsCount} active operation${digest.activeOpsCount === 1 ? "" : "s"}`);

  if (lines.length === 0) {
    return {
      title: `Today in ${userState ?? "kratom policy"}: quiet`,
      body: `No alerts, no tracked-bill movement, no fresh news. Good time to onboard a new advocate.`,
      // Relative path — the service worker resolves against its
      // registered origin (always prod). Avoids the failure mode where
      // a manual local run bakes APP_URL=http://localhost:3001 into
      // the push payload, sending broken links to real devices.
      link: "/brief",
      tag: "daily-brief",
    };
  }
  return {
    title: `Today in ${userState ?? "kratom policy"}`,
    body: lines.join(" · ") + " — tap to read",
    link: `${APP_URL}/brief`,
    tag: "daily-brief",
  };
}

async function fireForUser(userId, userState) {
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  const subscriptions = subs ?? [];
  if (subscriptions.length === 0) return { sent: 0, dropped: 0 };

  const digest = await getDigestForUser(userId, userState);
  const payload = buildPayload(digest, userState);

  // Drop a row in the in-app notifications table so the brief shows
  // up in /notifications even after the OS-level push is dismissed.
  // push-critical-alerts already does this; the brief was the only
  // push that never left a history trail.
  if (!DRY) {
    await sb.from("notifications").insert({
      user_id: userId,
      kind: "daily_brief",
      title: payload.title,
      body: payload.body,
      link: payload.link,
    });
  }

  let sent = 0, dropped = 0;
  for (const s of subscriptions) {
    if (DRY) {
      console.log(`  would push to ${s.endpoint.slice(0, 60)}…  →  ${payload.title} · ${payload.body}`);
      sent += 1;
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );
      sent += 1;
    } catch (e) {
      const status = e.statusCode ?? 0;
      if (status === 404 || status === 410) {
        // Subscription is gone — prune
        await sb.from("push_subscriptions").delete().eq("id", s.id);
        dropped += 1;
      } else {
        console.warn(`    send failed for ${userId}: ${e.message ?? e.body ?? "unknown"}`);
      }
    }
  }
  return { sent, dropped };
}

async function main() {
  const t0 = Date.now();
  console.log(`Daily brief push${DRY ? " (DRY RUN)" : ""}…`);

  // Find opted-in users
  let optInQuery = sb.from("notification_preferences")
    .select("user_id")
    .eq("daily_brief_push", true);
  if (ONLY_USER) optInQuery = optInQuery.eq("user_id", ONLY_USER);
  const { data: optedIn } = await optInQuery;
  const userIds = (optedIn ?? []).map((r) => r.user_id);
  console.log(`  ${userIds.length} opted-in user${userIds.length === 1 ? "" : "s"}`);
  if (userIds.length === 0) {
    await tag("empty", 0, 0);
    return;
  }

  // Fetch their state in one round-trip
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, state")
    .in("id", userIds);
  const stateById = new Map((profiles ?? []).map((p) => [p.id, p.state]));

  let totalSent = 0, totalDropped = 0, totalUsers = 0;
  for (const userId of userIds) {
    const { sent, dropped } = await fireForUser(userId, stateById.get(userId) ?? null);
    totalSent += sent;
    totalDropped += dropped;
    if (sent > 0) totalUsers += 1;
    process.stdout.write(`  ${totalUsers}/${userIds.length} users  ${totalSent} sent  ${totalDropped} dropped\r`);
  }
  console.log();
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${totalSent} pushes to ${totalUsers} users, ${totalDropped} stale subs pruned.`);
  await tag(DRY ? "empty" : "success", totalSent, totalDropped);
}

async function tag(status, sent, dropped) {
  try {
    await sb.from("scraper_runs").insert({
      source: "fire_daily_brief_push",
      started_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_updated: sent,
      notes: `${dropped} stale subscriptions pruned`,
    });
  } catch { /* best-effort */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
