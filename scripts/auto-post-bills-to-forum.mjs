#!/usr/bin/env node
/**
 * Keep each state's one "bill updates" thread current.
 *
 * Every state forum used to get a thread per bill, and 376 of 378 threads were
 * the bot's, so a member's thread disappeared among them (reported 2026-11-04).
 * Now a state has ONE running thread, and a new bill or a status change is a
 * comment in it. The old threads stay reachable from their bill pages, and
 * /forum/<state> only lists one again if a person replies to it.
 *
 * Eligibility:
 *   - bills.active = true
 *   - bills.kratom_relevance in ('anti', 'pro')
 *   - bills.scope in ('state', 'federal')          (municipal handled by /pulse)
 *   - bills.relevance_confidence >= 0.6
 *   - bills.forum_update_key differs from its status + last action date
 *
 * Run:
 *   node --env-file=.env.local scripts/auto-post-bills-to-forum.mjs
 *   node --env-file=.env.local scripts/auto-post-bills-to-forum.mjs --dry-run
 *   node --env-file=.env.local scripts/auto-post-bills-to-forum.mjs --seed
 *
 * --seed opens a state's thread with one list of what's live and stamps every
 * bill as announced. Run it once, so the first hourly run isn't a comment per bill.
 */
import { createClient } from "@supabase/supabase-js";
import {
  billUpdateComment,
  billUpdateKey,
  billWatchList,
  digestThreadBody,
  digestThreadTitle,
  forumKey,
  planBillPosts,
} from "./lib/forum-bill-updates.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DRY = process.argv.includes("--dry-run");
const SEED = process.argv.includes("--seed");
const MAX_COMMENTS_PER_RUN = 25;
const APP_URL = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ikratom.org";

const { data: stateRows } = await sb.from("states").select("abbr, name");
const stateNames = new Map((stateRows ?? []).map((s) => [s.abbr, s.name]));
const nameOf = (key) => (key === "US" ? "Federal" : stateNames.get(key) ?? key);

const threadIds = new Map();

/** The state's running thread, opened the first time it has something to say. */
async function digestThread(key) {
  if (threadIds.has(key)) return { id: threadIds.get(key), created: false };
  const { data: found } = await sb
    .from("forum_threads")
    .select("id")
    .eq("is_state_digest", true)
    .eq("state", key)
    .maybeSingle();
  if (found) {
    threadIds.set(key, found.id);
    return { id: found.id, created: false };
  }
  const name = nameOf(key);
  const { data: thread, error } = await sb
    .from("forum_threads")
    .insert({
      state: key,
      author_id: null,
      author_state: key,
      title: digestThreadTitle(name),
      body: digestThreadBody(name),
      tag: "legislation",
      system_generated: true,
      is_state_digest: true,
      moderation_status: "approved",
    })
    .select("id")
    .single();
  if (error) throw new Error(`thread for ${key}: ${error.message}`);
  threadIds.set(key, thread.id);
  return { id: thread.id, created: true };
}

async function postComment(threadId, key, body) {
  const { error } = await sb.from("forum_posts").insert({
    thread_id: threadId,
    author_id: null,
    author_state: key,
    body,
    moderation_status: "approved",
  });
  if (error) throw new Error(`comment for ${key}: ${error.message}`);
}

const stamp = (bill, threadId) =>
  sb
    .from("bills")
    .update({
      forum_update_key: billUpdateKey(bill),
      forum_thread_id: bill.forum_thread_id ?? threadId ?? null,
      forum_posted_at: new Date().toISOString(),
    })
    .eq("id", bill.id);

const { data, error } = await sb
  .from("bills")
  .select("id, state, bill_number, scope, status, last_action, last_action_at, title, kratom_relevance, forum_thread_id, forum_update_key")
  .eq("active", true)
  .in("kratom_relevance", ["anti", "pro"])
  .in("scope", ["state", "federal"])
  .gte("relevance_confidence", 0.6)
  .order("last_action_at", { ascending: false, nullsFirst: false })
  .limit(1000);
if (error) {
  console.error("Query error:", error.message);
  process.exit(1);
}
const bills = data ?? [];

let posted = 0;
let failed = 0;

if (SEED) {
  const byKey = new Map();
  for (const b of bills) byKey.set(forumKey(b), [...(byKey.get(forumKey(b)) ?? []), b]);
  for (const [key, group] of byKey) {
    console.log(`${key}: ${group.length} bill(s)`);
    if (DRY) continue;
    try {
      const { id, created } = await digestThread(key);
      if (created) {
        await postComment(id, key, billWatchList(nameOf(key), group, APP_URL));
        posted++;
      }
      for (const b of group) await stamp(b, id);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${e.message}`);
    }
  }
} else {
  const { comment, silent } = planBillPosts(bills);
  console.log(`${comment.length} to post, ${silent.length} already announced${DRY ? " (DRY RUN)" : ""}`);
  if (!DRY) {
    for (const b of silent) await stamp(b);
    for (const b of comment.slice(0, MAX_COMMENTS_PER_RUN)) {
      try {
        const key = forumKey(b);
        const { id } = await digestThread(key);
        await postComment(id, key, billUpdateComment(b, APP_URL));
        await stamp(b, id);
        posted++;
      } catch (e) {
        failed++;
        console.log(`  ✗ ${b.state} ${b.bill_number}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
console.log(`Done. posted=${posted}, failed=${failed}`);

// A run with nothing to post is still a run: check-cron-staleness pages on silence.
try {
  await sb.from("scraper_runs").insert({
    source: "auto_post_bills_to_forum",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: posted === 0 && failed === 0 ? "empty" : failed > posted ? "error" : "success",
    rows_added: posted,
    notes: `${posted} comments posted, ${failed} failed`,
  });
} catch { /* best-effort */ }

process.exit(0);
