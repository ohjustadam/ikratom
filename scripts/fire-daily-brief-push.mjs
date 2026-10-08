#!/usr/bin/env node
/**
 * fire-daily-brief-push.mjs — opt-in daily brief (in-app + push).
 *
 * For every user with `notification_preferences.daily_brief_push = true`,
 * compute a tiny digest preview ("3 alerts in OK + 2 watched bills moved")
 * and INSERT a single `daily_brief` notification. Delivery (the device buzz)
 * is handled by the hourly push fan-out (fanoutPushNotifications via
 * /api/cron/fire-waves), which coalesces the brief with anything else the
 * user has pending into ONE buzz and honors the global push opt-out
 * (in_app/digest), DND/quiet-hours, and the per-user rate-cap. Tap deep-links
 * to /brief.
 *
 * This script no longer direct-sends web push: it left rows pushed_at=NULL and
 * then pushed, so the fan-out re-delivered the same brief as a second buzz ~1h
 * later, and it ignored users who globally turned push off (digest='off').
 * Insert-only fixes both. Runs daily via cron-daily.yml at ~13:00 UTC (~8am ET);
 * a per-day idempotency guard keeps a workflow re-run from re-inserting.
 *
 * Cost: $0. web-push is free; payload is <4kb.
 *
 * Usage:
 *   node --env-file=.env.local scripts/fire-daily-brief-push.mjs
 *   node --env-file=.env.local scripts/fire-daily-brief-push.mjs --dry-run
 *   node --env-file=.env.local scripts/fire-daily-brief-push.mjs --user <user_id>
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const ONLY_USER = arg("--user");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// No VAPID needed here — this script only INSERTS the brief notification;
// the hourly push fan-out (which owns the VAPID keys) delivers the device buzz.

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

  // Absolute prod URL — devs can have service workers registered against
  // localhost from prior local testing; a relative link resolves against
  // the SW origin, which may not be prod. Hardcoding the canonical prod
  // origin ensures the click always lands on the live site regardless of
  // which SW handled the push.
  const link = "https://www.ikratom.org/brief";
  if (lines.length === 0) {
    return {
      title: `Today in ${userState ?? "kratom policy"}: quiet`,
      body: `No alerts, no tracked-bill movement, no fresh news. Good time to onboard a new advocate.`,
      link,
      tag: "daily-brief",
    };
  }
  return {
    title: `Today in ${userState ?? "kratom policy"}`,
    body: lines.join(" · ") + " — tap to read",
    link,
    tag: "daily-brief",
  };
}

async function fireForUser(userId, userState) {
  const digest = await getDigestForUser(userId, userState);
  const payload = buildPayload(digest, userState);

  if (DRY) {
    console.log(`  would queue brief for ${userId}  →  ${payload.title} · ${payload.body}`);
    return { queued: 0 };
  }

  // Insert the brief as an in-app notification. The hourly push fan-out picks
  // up this pushed_at=NULL row and delivers the device buzz — coalesced with
  // the user's other pending rows, and suppressed entirely if they turned push
  // off (in_app=false / digest='off') or are in DND / quiet-hours. This is the
  // history trail too (the brief shows in /notifications after the buzz clears).
  const { error } = await sb.from("notifications").insert({
    user_id: userId,
    kind: "daily_brief",
    title: payload.title,
    body: payload.body,
    link: payload.link,
  });
  if (error) {
    console.warn(`    insert failed for ${userId}: ${error.message?.slice(0, 80)}`);
    return { queued: 0 };
  }
  return { queued: 1 };
}

async function pruneLocalhostSubs() {
  // Prune push_subscriptions registered against localhost or 127.0.0.1.
  // These were created during local dev — they receive pushes but the
  // click navigates to an unreachable origin (ERR_CONNECTION_REFUSED).
  // Legacy rows with origin=null are left alone (we can't prove they
  // were dev-only).
  if (DRY) return;
  const { data, error } = await sb
    .from("push_subscriptions")
    .delete()
    .or("origin.ilike.%localhost%,origin.ilike.%127.0.0.1%")
    .select("id, origin");
  if (error) {
    console.warn(`  prune-localhost-subs: ${error.message?.slice(0, 80)}`);
    return;
  }
  if (data && data.length > 0) {
    console.log(`  pruned ${data.length} localhost-origin push sub(s)`);
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`Daily brief push${DRY ? " (DRY RUN)" : ""}…`);

  // Per-day idempotency guard (Eastern — civic "today" anchors to
  // America/New_York, never bare UTC): a workflow re-run after a partial
  // daily-cron failure must not re-fire the brief. The push tag already
  // replaces rather than stacks, but re-sending still burns quota and
  // re-buzzes phones. --force (or --user targeting) overrides.
  const easternDate = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (!DRY && !ONLY_USER && !args.includes("--force")) {
    const { data: lastRun } = await sb
      .from("scraper_runs")
      .select("finished_at, status")
      .eq("source", "fire_daily_brief_push")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastRun?.finished_at && easternDate(lastRun.finished_at) === easternDate(Date.now())) {
      console.log(`Already fired today (${easternDate(Date.now())} ET) — skipping. Use --force to re-send.`);
      return;
    }
  }

  await pruneLocalhostSubs();

  // Find opted-in users. DND/quiet-hours/opt-out are now enforced by the push
  // fan-out at delivery time, so this query only needs the opt-in flag.
  let optInQuery = sb.from("notification_preferences")
    .select("user_id")
    .eq("daily_brief_push", true);
  if (ONLY_USER) optInQuery = optInQuery.eq("user_id", ONLY_USER);
  const { data: optedIn } = await optInQuery;
  const userIds = (optedIn ?? []).map((r) => r.user_id);
  console.log(`  ${userIds.length} opted-in user${userIds.length === 1 ? "" : "s"}`);
  if (userIds.length === 0) {
    await tag("empty", 0);
    return;
  }

  // Fetch their state in one round-trip
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, state")
    .in("id", userIds);
  const stateById = new Map((profiles ?? []).map((p) => [p.id, p.state]));

  let totalQueued = 0;
  for (const userId of userIds) {
    const { queued } = await fireForUser(userId, stateById.get(userId) ?? null);
    totalQueued += queued;
    process.stdout.write(`  ${totalQueued}/${userIds.length} briefs queued\r`);
  }
  console.log();
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${totalQueued} briefs queued for ${userIds.length} opted-in user(s); delivery via the hourly push fan-out.`);
  await tag(DRY ? "empty" : "success", totalQueued);
}

async function tag(status, queued) {
  try {
    await sb.from("scraper_runs").insert({
      source: "fire_daily_brief_push",
      started_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_updated: queued,
      notes: `${queued} daily-brief notifications queued (delivery via push fan-out)`,
    });
  } catch { /* best-effort */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
