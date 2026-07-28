#!/usr/bin/env node
/**
 * Auto-post bills to their state forum as system threads.
 *
 * Goal: when an anti- or pro-kratom bill goes active, members opening
 * /forum/<state> should see a system-posted thread with the bill summary,
 * status, sponsors, and a deep-link to /bills/<id>. This drives discovery
 * of bill detail pages and seeds discussion in the right state forum.
 *
 * Eligibility (each tick):
 *   - bills.active = true
 *   - bills.kratom_relevance in ('anti', 'pro')   (skip neutral)
 *   - bills.forum_thread_id IS NULL                (idempotent)
 *   - bills.scope in ('state', 'federal')          (municipal handled by /pulse)
 *   - bills.relevance_confidence >= 0.6 OR explicitly active
 *
 * Run:
 *   node --env-file=.env.local scripts/auto-post-bills-to-forum.mjs
 *   node --env-file=.env.local scripts/auto-post-bills-to-forum.mjs --dry-run
 *   node --env-file=.env.local scripts/auto-post-bills-to-forum.mjs --bill <id>
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = arg("--bill");
const DRY = args.includes("--dry-run");

const APP_URL = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ikratom.org";

// Map kratom_relevance + scope to a forum tag
function tagFor(bill) {
  return "legislation";
}

function relevanceBadge(bill) {
  if (bill.kratom_relevance === "anti") return "🚫 Restrictive";
  if (bill.kratom_relevance === "pro") return "✅ Supportive";
  return "📋 Tracked";
}

function statusBadge(status) {
  if (!status) return "introduced";
  return status;
}

function buildThreadTitle(bill) {
  const scope = bill.scope === "federal" ? "Federal" : (bill.state ?? "");
  // Prefix lets state forum threads scan-read at a glance.
  return [
    `[${relevanceBadge(bill)}]`,
    `${scope} ${bill.bill_number}`,
    "—",
    (bill.title ?? "").slice(0, 140),
  ].join(" ").slice(0, 240);
}

function buildThreadBody(bill) {
  const lines = [];
  lines.push(`> 🤖 Auto-posted by iKratom bot. This thread tracks **${bill.state ?? "FED"} ${bill.bill_number}**. Reply with on-the-ground updates, hearing audio, lobbyist sightings, anything that helps the rest of us understand what's actually happening.`);
  lines.push("");
  lines.push(`**Status:** ${statusBadge(bill.status)}`);
  if (bill.last_action) lines.push(`**Last action:** ${bill.last_action}${bill.last_action_at ? ` (${new Date(bill.last_action_at).toLocaleDateString()})` : ""}`);
  if (bill.kratom_relevance) lines.push(`**Stance:** ${relevanceBadge(bill)}`);
  if (typeof bill.relevance_confidence === "number") {
    lines.push(`**Confidence:** ${(bill.relevance_confidence * 100).toFixed(0)}%`);
  }
  lines.push("");

  // Prefer the AI-distilled summary if present (shorter, more advocate-readable);
  // fall back to the official summary otherwise.
  const summary = bill.summary_ai || bill.summary;
  if (summary) {
    lines.push("**Summary**");
    lines.push(String(summary).slice(0, 1500));
    lines.push("");
  }

  if (bill.advocacy_callout) {
    lines.push("**Why it matters**");
    lines.push(String(bill.advocacy_callout).slice(0, 800));
    lines.push("");
  }

  lines.push(`**One-click action:** [bill page](${APP_URL}/bills/${bill.id}) → has the full text, sponsor contact buttons, and any active campaigns.`);
  if (bill.source_url) {
    lines.push(`**Official source:** [${bill.source_url}](${bill.source_url})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("_Threads like this auto-post when an active anti- or pro-kratom bill is detected by the platform. Subscribe to /bills/<id> to get push notifications when status changes._");
  return lines.join("\n");
}

async function postBill(bill) {
  console.log(`\n=== ${bill.id.slice(0, 8)} | ${bill.state ?? "FED"} ${bill.bill_number} | ${bill.kratom_relevance} ===`);

  if (bill.forum_thread_id) {
    console.log(`  ⏭  already posted: thread ${bill.forum_thread_id.slice(0, 8)}`);
    return false;
  }

  const title = buildThreadTitle(bill);
  const body = buildThreadBody(bill);
  const tag = tagFor(bill);

  if (DRY) {
    console.log(`  DRY RUN — would post:`);
    console.log(`    state: ${bill.state ?? "(federal — null state)"}`);
    console.log(`    title: ${title}`);
    console.log(`    body length: ${body.length}`);
    return true;
  }

  // Federal bills need a state value to anchor a forum (forum is state-anchored).
  // Convention: federal threads get state=null; the existing forum index handles
  // null-state threads as "Federal / multistate".
  const threadState = bill.scope === "federal" ? null : bill.state;

  const { data: thread, error } = await sb
    .from("forum_threads")
    .insert({
      state: threadState,
      author_id: null,                    // system-generated; NULL on delete set null
      author_state: bill.state ?? null,
      title,
      body,
      tag,
      system_generated: true,
      moderation_status: "approved",      // bypasses queue (default is also 'approved' but explicit)
    })
    .select("id")
    .single();

  if (error) {
    console.log(`  ✗ thread insert failed: ${error.message}`);
    return false;
  }
  console.log(`  ✓ thread created: ${thread.id.slice(0, 8)}`);

  // Link bill back so we never repost
  const { error: linkErr } = await sb
    .from("bills")
    .update({ forum_thread_id: thread.id, forum_posted_at: new Date().toISOString() })
    .eq("id", bill.id);
  if (linkErr) {
    console.log(`  ⚠ link back failed: ${linkErr.message}`);
  }
  return true;
}

let bills;
if (SPECIFIC) {
  const { data } = await sb
    .from("bills")
    .select("id, state, bill_number, scope, status, last_action, last_action_at, title, summary, summary_ai, kratom_relevance, relevance_confidence, source_url, active, forum_thread_id, advocacy_callout, journey_narrative")
    .eq("id", SPECIFIC)
    .single();
  bills = data ? [data] : [];
} else {
  // Eligible bills — active anti/pro bills not yet posted, oldest unposted first
  // so a long backlog doesn't preempt newer urgent ones.
  const { data, error } = await sb
    .from("bills")
    .select("id, state, bill_number, scope, status, last_action, last_action_at, title, summary, summary_ai, kratom_relevance, relevance_confidence, source_url, active, forum_thread_id, advocacy_callout, journey_narrative")
    .eq("active", true)
    .in("kratom_relevance", ["anti", "pro"])
    .in("scope", ["state", "federal"])
    .is("forum_thread_id", null)
    .gte("relevance_confidence", 0.6)
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(25);   // cap per run so we don't dump 100 threads at once on first activation
  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }
  bills = data ?? [];
}

// "Nothing to post" is a SUCCESSFUL run and has to be recorded as one. This
// used to `process.exit(0)` straight out, skipping the scraper_runs write ~40
// lines below — so in the steady state (every bill already posted) the job ran
// green hourly while check-cron-staleness saw the source as 10+ days old and
// paged about it. Same defect as reject-wrongstate-pending-alerts and
// extract-local-vote-outcomes, just via an early exit instead of an enclosing
// `if`. An alarm that fires on a healthy system teaches you to ignore alarms.
if (bills.length === 0) {
  console.log("Nothing to post.");
  try {
    await sb.from("scraper_runs").insert({
      source: "auto_post_bills_to_forum",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "empty",
      rows_added: 0,
      notes: "no unposted bills — every eligible bill already has a forum thread",
    });
  } catch { /* best-effort */ }
  process.exit(0);
}
console.log(`Auto-posting ${bills.length} bill(s) to state forums${DRY ? " (DRY RUN)" : ""}…`);

let ok = 0, fail = 0;
for (const b of bills) {
  if (await postBill(b)) ok++; else fail++;
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`\nDone. posted=${ok}, skipped/failed=${fail}`);

try {
  await sb.from("scraper_runs").insert({
    source: "auto_post_bills_to_forum",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: ok === 0 && fail === 0 ? "empty" : (fail > ok ? "error" : "success"),
    rows_added: ok,
    notes: `${ok} threads posted, ${fail} skipped/failed`,
  });
} catch { /* best-effort */ }

process.exit(0);
