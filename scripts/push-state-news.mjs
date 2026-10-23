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
 *   - body_extracted_at IS NOT NULL (content-ready — never notify about an
 *     article whose body + media haven't been extracted/attached yet)
 *   - auto_pushed_at IS NULL (per-item dedupe via migration 0122)
 *   - NOT linked to a policy_alert that's already been auto_pushed
 *     (avoids double-push when news promotes to alert)
 *   - NOT the same story as one this state was pushed in the last 72h, and
 *     at most ONE news push per state per 20h. Until 2026-10-23 each outlet
 *     was its own push: Louisiana members got 7 pushes about one emergency
 *     rule in two days and read it as the same news on repeat.
 *   - NOT a headline that names other states but not this one (a Utah story
 *     filed under LA).
 * Skipped items are stamped with auto_pushed_count 0; they still appear in
 * the digest and on /news.
 *
 * Caps: 10 items per run (deliberately tighter than alerts because
 * news volume is higher).
 *
 * Run:
 *   node --env-file=.env.local scripts/push-state-news.mjs
 *   node --env-file=.env.local scripts/push-state-news.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { headlineWords, sameStory } from "./lib/story-dedupe.mjs";
import { mentionedStates } from "./lib/us-states.mjs";

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
  .not("body_extracted_at", "is", null)
  .is("auto_pushed_at", null)
  .order("published_at", { ascending: false })
  .limit(10);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

console.log(`Push-state-news${DRY_RUN ? " [DRY RUN]" : ""}: ${items.length} item(s) to process\n`);

// What each state was actually pushed recently: the memory for the same-story
// and once-a-day checks below.
const RECENT_MS = 72 * 3600e3;
const DAILY_MS = 20 * 3600e3; // the job is hourly; 20h keeps it to one a day
const { data: recent, error: recentErr } = await sb
  .from("news_items")
  .select("state, title, auto_pushed_at")
  .gt("auto_pushed_count", 0)
  .gte("auto_pushed_at", new Date(Date.now() - RECENT_MS).toISOString())
  .not("state", "is", null)
  .limit(1000);
if (recentErr) {
  // Without the memory every outlet would push again. Skip this run instead.
  console.error("Recent-push query failed:", recentErr.message);
  process.exit(1);
}
const pushedByState = new Map();
const remember = (state, title, at) => {
  const list = pushedByState.get(state) ?? [];
  list.push({ w: headlineWords(title), at });
  pushedByState.set(state, list);
};
for (const r of recent ?? []) remember(r.state, r.title, Date.parse(r.auto_pushed_at));

/** Why this item should not be pushed, or null. */
function skipReason(item) {
  const named = mentionedStates(item.title);
  if (named.size > 0 && !named.has(item.state)) return "other_state";
  const prior = pushedByState.get(item.state) ?? [];
  const w = headlineWords(item.title);
  if (prior.some((p) => sameStory(w, p.w))) return "same_story";
  if (prior.some((p) => Date.now() - p.at < DAILY_MS)) return "daily_cap";
  return null;
}

const t0 = Date.now();
let totalInserted = 0;
let totalUsers = 0;
let skippedDoublePush = 0;
const skipped = { other_state: 0, same_story: 0, daily_cap: 0 };

for (const item of items) {
  const reason = skipReason(item);
  if (reason) {
    console.log(`  · ${item.state}: ${item.title.slice(0, 50)} — skipped (${reason})`);
    if (!DRY_RUN) {
      await sb.from("news_items").update({ auto_pushed_at: new Date().toISOString(), auto_pushed_count: 0 }).eq("id", item.id);
    }
    skipped[reason]++;
    continue;
  }

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
  const body = `${item.source_name ?? "Source"} · read it on iKratom`;
  // Link to iKratom's reader, never the publisher. The query above already
  // requires body_extracted_at, so the full article is on our page: no
  // publisher ads, and the related bill/action sits beside it. (Until
  // 2026-10-03 this pushed raw news.google.com redirect URLs.)
  const link = `/news/${item.id}`;

  if (DRY_RUN) {
    console.log(`  [dry] ${item.state}: ${item.title.slice(0, 60)} → ${userIds.length} user(s)`);
    totalUsers += userIds.length;
    remember(item.state, item.title, Date.now());
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
  if (inserted > 0) remember(item.state, item.title, Date.now());
  console.log(`  ✓ ${item.state}: ${item.title.slice(0, 50)} → ${inserted} notifs`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const skipNote = `${skipped.same_story} same story · ${skipped.daily_cap} daily cap · ${skipped.other_state} other state`;
console.log(`\nDone in ${elapsed}s — ${items.length} items, ${totalInserted} notifs, ${totalUsers} user-touches, ${skippedDoublePush} skipped (already pushed via alert), ${skipNote}.`);

try {
  await sb.from("scraper_runs").insert({
    source: "push_state_news",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalInserted > 0 ? "success" : "empty",
    rows_added: totalInserted,
    notes: `${items.length} items · ${totalInserted} notifs · ${skippedDoublePush} skipped · ${skipNote}`,
  });
} catch { /* */ }
process.exit(0);
