#!/usr/bin/env node
/**
 * Fan out high-severity policy_alerts to in-state users via in-app
 * notifications. The existing fanoutPushNotifications cron picks up
 * any new notifications and delivers them as web push automatically —
 * so this script only inserts notifications rows, doesn't talk to
 * web-push directly.
 *
 * Selection criteria (intentionally strict to avoid notification fatigue):
 *   - moderation_status = 'approved'
 *   - severity IN ('critical', 'alert')
 *   - auto_pushed_at IS NULL                  (per-alert dedupe)
 *   - created_at >= now() - 24h               (skip backfills/old alerts)
 *
 * For each qualifying alert:
 *   - If locality matches a 2-letter state code → target users in that state
 *   - If locality is null / "US" / "FED" → target ALL users (federal-scope)
 *   - Otherwise (city name like "Marshall, IL") → match users in the
 *     embedded state code only
 *
 * Caps:
 *   - Max 20 alerts processed per run (so a backfill burst doesn't blast
 *     500 alerts × N users in one tick)
 *   - 200 notifications inserted per chunk
 *
 * Wires into the hourly cron alongside the news pipeline. Latency:
 *   news article → classified into policy_alert → admin approves
 *   → next hourly tick fires push.  ~60min worst case from approval.
 *
 * Run:
 *   node --env-file=.env.local scripts/push-critical-alerts.mjs
 *   node --env-file=.env.local scripts/push-critical-alerts.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

// User-facing alert kinds — anything ELSE (scraper_stale, internal admin
// data-quality flags, etc) is excluded from auto-push to prevent
// notification spam with admin-grade noise.
const USER_FACING_KINDS = new Set([
  "dea_action",       // federal DEA scheduling action
  "fda_action",       // federal FDA action
  "bill_event",       // state bill event (introduction, vote, signing, etc.)
  "bop_hearing",      // board of pharmacy hearing (incl. broadcast meetings)
  "news_break",       // breaking news article
  "city_ordinance",   // municipal ordinance
  "city_event",       // municipal council event
  "ag_action",        // state AG action
]);

const STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
]);

/**
 * Extract the relevant state code from policy_alerts.locality.
 *   "NY"           → "NY"
 *   "Marshall, IL" → "IL"
 *   "US" / null    → null  (federal — fan out to everyone)
 */
function extractStateCode(locality) {
  if (!locality) return null;
  const trimmed = locality.trim();
  if (trimmed === "US" || trimmed === "FED" || trimmed.toLowerCase() === "federal") return null;
  if (STATE_CODES.has(trimmed.toUpperCase())) return trimmed.toUpperCase();
  // Try "City, ST" or "County, ST" pattern
  const m = trimmed.match(/,\s*([A-Z]{2})\s*$/i);
  if (m && STATE_CODES.has(m[1].toUpperCase())) return m[1].toUpperCase();
  return null;
}

async function findTargetUsers(stateCode) {
  if (stateCode === null) {
    // Federal-scope: fan out to all users
    const { data } = await sb.from("profiles").select("id").limit(50_000);
    return (data ?? []).map((u) => u.id);
  }
  const { data } = await sb
    .from("profiles")
    .select("id")
    .eq("state", stateCode)
    .limit(50_000);
  return (data ?? []).map((u) => u.id);
}

async function processAlert(a) {
  const stateCode = extractStateCode(a.locality);
  const userIds = await findTargetUsers(stateCode);

  if (userIds.length === 0) {
    console.log(`  · ${a.title.slice(0, 60)} (no users in ${stateCode ?? "federal"}) — stamping anyway`);
    if (!DRY_RUN) {
      await sb.from("policy_alerts").update({
        auto_pushed_at: new Date().toISOString(),
        auto_pushed_count: 0,
      }).eq("id", a.id);
    }
    return { alert: a.id, userIds: 0, inserted: 0 };
  }

  const stateLabel = stateCode ?? "federal";
  const severityEmoji = a.severity === "critical" ? "🚨" : "⚠️";
  const title = `${severityEmoji} ${stateLabel}: ${a.title.slice(0, 100)}`;
  const body = a.body ? a.body.split("\n")[0].slice(0, 180) : "Tap for the full briefing.";
  const link = `/pulse#alert-${a.id}`;

  if (DRY_RUN) {
    console.log(`  [dry] ${title.slice(0, 80)} → ${userIds.length} ${stateLabel} users`);
    return { alert: a.id, userIds: userIds.length, inserted: 0 };
  }

  // Build notifications rows; the existing fanoutPushNotifications cron
  // turns these into web push deliveries.
  const rows = userIds.map((uid) => ({
    user_id: uid,
    kind: "policy_alert",
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
    if (error) console.log(`    ✗ notif chunk: ${error.message?.slice(0, 80)}`);
    else inserted += count ?? chunk.length;
  }
  // Stamp the alert so we don't fan it out again on next tick.
  await sb.from("policy_alerts").update({
    auto_pushed_at: new Date().toISOString(),
    auto_pushed_count: inserted,
  }).eq("id", a.id);
  console.log(`  ✓ ${title.slice(0, 60)} · ${stateLabel} · ${inserted} notif`);
  return { alert: a.id, userIds: userIds.length, inserted };
}

// ---------- main ----------
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { data: alerts, error } = await sb
  .from("policy_alerts")
  .select("id, kind, title, body, severity, locality, created_at")
  .in("severity", ["critical", "alert"])
  .in("kind", [...USER_FACING_KINDS])    // exclude scraper_stale + other admin-only kinds
  .eq("moderation_status", "approved")
  .is("auto_pushed_at", null)
  .gte("created_at", since)
  .order("created_at", { ascending: true })
  .limit(20);

if (error) {
  // Most likely auto_pushed_at column hasn't been migrated yet.
  console.error("Query failed:", error.message);
  process.exit(1);
}

console.log(`Push-critical-alerts${DRY_RUN ? " [DRY RUN]" : ""}: ${alerts.length} alert(s) to process\n`);

const t0 = Date.now();
let totalInserted = 0;
let totalUsers = 0;
const results = [];
for (const a of alerts) {
  const r = await processAlert(a);
  results.push(r);
  totalInserted += r.inserted ?? 0;
  totalUsers += r.userIds ?? 0;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s — ${results.length} alerts, ${totalInserted} notifications inserted, ${totalUsers} unique user-touches.`);

try {
  await sb.from("scraper_runs").insert({
    source: "push_critical_alerts",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    notes: `${results.length} alerts · ${totalInserted} notifs · ${totalUsers} user-touches`,
  });
} catch { /* best-effort */ }
process.exit(0);
