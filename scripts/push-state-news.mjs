#!/usr/bin/env node
/**
 * Push state-relevant news items to in-state users.
 *
 * Complements push-critical-alerts.mjs: alerts are policy events
 * (bill signings, DEA action, BoP hearings). High-relevance news
 * stays in news_items unless promoted — and those legitimate state
 * stories should still reach in-state advocates.
 *
 * Strict gating to prevent notification fatigue:
 *   - body_has_kratom_keyword IS NOT FALSE (false-positive defense)
 *   - ai_relevance_score >= 0.85 (high bar)
 *   - state IS NOT NULL (must be state-specific)
 *   - published_at >= now() - 12h (fresh — don't push old news)
 *   - auto_pushed_at IS NULL (per-item dedupe via migration 0122)
 *   - NOT linked to a policy_alert that's already been auto_pushed
 *     (avoids double-push when news promotes to alert)
 *
 * Caps: 10 items per run (deliberately tighter than alerts because
 * news volume is higher).
 *
 * Run:
 *   node --env-file=.env.local scripts/push-state-news.mjs
 *   node --env-file=.env.local scripts/push-state-news.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

const { data: items, error } = await sb
  .from("news_items")
  .select("id, state, title, url, source_name, published_at, ai_relevance_score, policy_alert_id")
  .gte("ai_relevance_score", 0.85)
  .gte("published_at", since)
  .not("state", "is", null)
  .not("body_has_kratom_keyword", "is", false)
  .is("auto_pushed_at", null)
  .order("published_at", { ascending: false })
  .limit(10);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

console.log(`Push-state-news${DRY_RUN ? " [DRY RUN]" : ""}: ${items.length} item(s) to process\n`);

const t0 = Date.now();
let totalInserted = 0;
let totalUsers = 0;
let skippedDoublePush = 0;

for (const item of items) {
  // Skip if linked policy_alert was already auto-pushed (prevents double-push)
  if (item.policy_alert_id) {
    const { data: alert } = await sb
      .from("policy_alerts")
      .select("auto_pushed_at")
      .eq("id", item.policy_alert_id)
      .maybeSingle();
    if (alert?.auto_pushed_at) {
      console.log(`  · ${item.state}: ${item.title.slice(0, 50)} — already pushed via policy_alert`);
      if (!DRY_RUN) {
        await sb.from("news_items").update({ auto_pushed_at: new Date().toISOString(), auto_pushed_count: 0 }).eq("id", item.id);
      }
      skippedDoublePush++;
      continue;
    }
  }

  // Find in-state users
  const { data: users } = await sb
    .from("profiles")
    .select("id")
    .eq("state", item.state)
    .limit(50_000);
  const userIds = (users ?? []).map((u) => u.id);

  if (userIds.length === 0) {
    console.log(`  · ${item.state}: ${item.title.slice(0, 50)} — no in-state users, stamping`);
    if (!DRY_RUN) {
      await sb.from("news_items").update({ auto_pushed_at: new Date().toISOString(), auto_pushed_count: 0 }).eq("id", item.id);
    }
    continue;
  }

  const title = `📰 ${item.state}: ${item.title.slice(0, 100)}`;
  const body = `${item.source_name ?? "Source"} · tap to read`;
  // Link to the news source — that's where the actual content lives
  const link = item.url;

  if (DRY_RUN) {
    console.log(`  [dry] ${item.state}: ${item.title.slice(0, 60)} → ${userIds.length} user(s)`);
    totalUsers += userIds.length;
    continue;
  }

  const rows = userIds.map((uid) => ({
    user_id: uid,
    kind: "state_news",
    title,
    body,
    link,
  }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error: insErr, count } = await sb.from("notifications").insert(chunk, { count: "exact" });
    if (insErr) console.log(`    ✗ notif chunk: ${insErr.message?.slice(0, 80)}`);
    else inserted += count ?? chunk.length;
  }
  await sb.from("news_items").update({
    auto_pushed_at: new Date().toISOString(),
    auto_pushed_count: inserted,
  }).eq("id", item.id);

  totalInserted += inserted;
  totalUsers += userIds.length;
  console.log(`  ✓ ${item.state}: ${item.title.slice(0, 50)} → ${inserted} notifs`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s — ${items.length} items, ${totalInserted} notifs, ${totalUsers} user-touches, ${skippedDoublePush} skipped (already pushed via alert).`);

try {
  await sb.from("scraper_runs").insert({
    source: "push_state_news",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    notes: `${items.length} items · ${totalInserted} notifs · ${skippedDoublePush} skipped`,
  });
} catch { /* */ }
process.exit(0);
