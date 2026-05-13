#!/usr/bin/env node
/**
 * Push notifications to users when bills they've taken action on
 * have status changes.
 *
 * Closes the loop on the engagement vision: if you spent 2 minutes
 * emailing your rep about a bill via iKratom, you should know within
 * the hour when that bill moves through committee, hits the floor,
 * or gets signed.
 *
 * Pipeline:
 *   1. Find bill_actions in the last 6 hours (created_at).
 *   2. For each, find users who took action on that bill_id via
 *      campaign_actions (joined through campaigns.bill_id).
 *   3. Skip pairs already in bill_action_user_pushes (dedupe).
 *   4. Insert notifications row + record dedupe entry.
 *   5. Existing fanoutPushNotifications cron delivers as web push.
 *
 * Caps:
 *   - 50 bill_actions per run (so a sync burst doesn't blast everyone)
 *   - Notifications chunked at 200/insert
 *
 * Run:
 *   node --env-file=.env.local scripts/push-bill-actions-to-actors.mjs
 *   node --env-file=.env.local scripts/push-bill-actions-to-actors.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Freshness: filter on action_date (when the action ACTUALLY happened)
// not created_at (when we INGESTED the row). LegiScan / OpenStates
// backfills land months-old actions with today's created_at — same
// bug class as PR #199 on push-critical-alerts.
//
// 7-day window: bills move slowly; a status change a week ago is
// still actionable news to someone who emailed about that bill,
// but anything 30+ days old is definitely stale.
const sinceAction = new Date(Date.now() - 7 * 86_400_000).toISOString();
// Also exclude actions whose row was ingested >6h ago — even if the
// action is recent, if we ingested it before our last push run, we
// already had the chance to push then. This prevents re-pushing
// on every cron tick after a wide bill_actions backfill.
const sinceIngested = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

// 1. Fresh bill_actions — BOTH the action itself and our ingest must be recent
const { data: actions, error: actErr } = await sb
  .from("bill_actions")
  .select("id, bill_id, action_date, description, chamber, created_at, bills!inner(id, state, bill_number, title, status, kratom_relevance)")
  .gte("action_date", sinceAction)
  .gte("created_at", sinceIngested)
  .order("action_date", { ascending: false })
  .limit(50);

if (actErr) {
  console.error("Query failed:", actErr.message);
  process.exit(1);
}

console.log(`Bill-action push${DRY_RUN ? " [DRY RUN]" : ""}: ${actions.length} fresh bill_action(s) in last 6h\n`);

const t0 = Date.now();
let totalUsers = 0;
let totalInserted = 0;

for (const ba of actions) {
  // Supabase nests joined relation — may be array or object
  const bill = Array.isArray(ba.bills) ? ba.bills[0] : ba.bills;
  if (!bill) continue;

  // 2. Users who took action on this bill (joined through campaigns)
  const { data: campaigns } = await sb
    .from("campaigns")
    .select("id")
    .eq("bill_id", ba.bill_id);
  const campaignIds = (campaigns ?? []).map((c) => c.id);
  if (campaignIds.length === 0) continue;

  const { data: actors } = await sb
    .from("campaign_actions")
    .select("user_id")
    .in("campaign_id", campaignIds);
  const userIds = Array.from(new Set((actors ?? []).map((a) => a.user_id))).filter(Boolean);
  if (userIds.length === 0) continue;

  // 3. Skip users already pushed for this bill_action
  const { data: alreadyPushed } = await sb
    .from("bill_action_user_pushes")
    .select("user_id")
    .eq("bill_action_id", ba.id)
    .in("user_id", userIds);
  const pushedSet = new Set((alreadyPushed ?? []).map((p) => p.user_id));
  const newUsers = userIds.filter((u) => !pushedSet.has(u));

  if (newUsers.length === 0) {
    console.log(`  · ${bill.state} ${bill.bill_number}: all ${userIds.length} actors already pushed`);
    continue;
  }

  // Stance-aware emoji
  const stanceEmoji = bill.kratom_relevance === "anti" ? "🚫" : "✅";
  const title = `${stanceEmoji} ${bill.state} ${bill.bill_number}: ${(ba.description ?? "status changed").slice(0, 80)}`;
  const body = `${bill.title?.slice(0, 140) ?? ""}\n\nNew status: ${bill.status ?? "(unknown)"}`;
  const link = `/bills/${bill.id}`;

  if (DRY_RUN) {
    console.log(`  [dry] ${bill.state} ${bill.bill_number}: would push to ${newUsers.length} actor(s)`);
    totalUsers += newUsers.length;
    continue;
  }

  // 4. Insert notifications
  const rows = newUsers.map((uid) => ({
    user_id: uid,
    kind: "bill_action",
    title,
    body,
    link,
  }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error, count } = await sb.from("notifications").insert(chunk, { count: "exact" });
    if (error) console.log(`    ✗ notif chunk: ${error.message?.slice(0, 80)}`);
    else inserted += count ?? chunk.length;
  }

  // 5. Mark dedupe
  const dedupeRows = newUsers.map((uid) => ({ user_id: uid, bill_action_id: ba.id }));
  for (let i = 0; i < dedupeRows.length; i += 500) {
    await sb.from("bill_action_user_pushes").insert(dedupeRows.slice(i, i + 500));
  }

  totalUsers += newUsers.length;
  totalInserted += inserted;
  console.log(`  ✓ ${bill.state} ${bill.bill_number}: pushed to ${newUsers.length} actor(s)`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s — ${actions.length} bill_actions checked, ${totalInserted} notifications inserted, ${totalUsers} actor-touches.`);

try {
  await sb.from("scraper_runs").insert({
    source: "push_bill_actions_to_actors",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    notes: `${actions.length} bill_actions · ${totalInserted} notifs · ${totalUsers} actors`,
  });
} catch { /* */ }
process.exit(0);
