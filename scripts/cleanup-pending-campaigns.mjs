#!/usr/bin/env node
/**
 * One-shot deep cleanup of the auto-campaign pending_review queue.
 *
 * The auto-create paths (trg_auto_campaign_on_alert + scripts/
 * auto-campaign-from-alert.mjs) generate one campaign per policy_alert.
 * Multiple news articles about the same event create multiple alerts
 * → multiple campaigns → unworkable pending queue (1000+ items).
 *
 * This script applies three sweeps:
 *
 *   1. TOPIC CLUSTER collapse: group pending_review auto campaigns by
 *      (state, kratom_keyword, event_word). Within each cluster, keep
 *      the MOST RECENT (it has the freshest title + admin signal) and
 *      supersede the rest. Tennessee kratom-ban campaigns all collapse
 *      to one; same for MI, FL, etc.
 *
 *   2. STALE expiry: pending_review items older than 45 days get
 *      rejected. If admin hasn't reviewed in 45 days the underlying
 *      event has either resolved or moved on.
 *
 *   3. FP-derived rejection: pending campaigns whose linked
 *      policy_alert's source_url matches an FP-flagged news_item get
 *      rejected. PR #143's body_has_kratom_keyword=false flags shouldn't
 *      keep generating campaigns.
 *
 * Sets:
 *   - cluster duplicates → review_state='superseded' + superseded_by=<canonical>
 *   - stale items       → review_state='rejected' + review_reason
 *   - FP-derived items  → review_state='rejected' + review_reason
 *
 * Run:
 *   node --env-file=.env.local scripts/cleanup-pending-campaigns.mjs --dry-run
 *   node --env-file=.env.local scripts/cleanup-pending-campaigns.mjs
 *   node --env-file=.env.local scripts/cleanup-pending-campaigns.mjs --stale-days 30
 */
import { createClient } from "@supabase/supabase-js";
import { topicKey } from "./lib/topic-key.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const staleIdx = args.indexOf("--stale-days");
const STALE_DAYS = staleIdx >= 0 ? parseInt(args[staleIdx + 1]) || 45 : 45;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// topicKey(state, title) is imported from ./lib/topic-key.mjs — this file was
// its original home; the logic is unchanged and now shared with the auto-approve
// engine so the janitor and the engine cluster identically.

// ---------- main ----------
const t0 = Date.now();
console.log(`Cleanup mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

// Pull all pending_review auto campaigns
let pending = [];
for (let from = 0; from < 5000; from += 1000) {
  const { data } = await sb.from("campaigns")
    .select("id, slug, title, state, created_at, bill_id")
    .eq("review_state", "pending_review")
    .eq("auto_generated", true)
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  pending = pending.concat(data);
  if (data.length < 1000) break;
}
console.log(`Found ${pending.length} pending_review auto campaigns\n`);

// ─── Pass 1: Topic-cluster collapse ─────────────────────────────────
const clusters = new Map();
for (const c of pending) {
  const k = topicKey(c.state, c.title);
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(c);
}
const dupClusters = Array.from(clusters.entries()).filter(([, rs]) => rs.length > 1);
let supersededCount = 0;
console.log(`Pass 1: topic-cluster collapse`);
console.log(`  ${clusters.size} unique topic keys`);
console.log(`  ${dupClusters.length} clusters with >1 pending campaign`);

for (const [key, rows] of dupClusters) {
  // Keep most-recent (largest created_at); supersede the rest.
  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const canonical = rows[0];
  const losers = rows.slice(1);
  if (losers.length === 0) continue;
  console.log(`  [${key}] ${rows.length} campaigns → keep ${canonical.id.slice(0, 8)} (${canonical.title?.slice(0, 50)})`);
  for (const l of losers) {
    if (!DRY_RUN) {
      await sb.from("campaigns").update({
        review_state: "superseded",
        superseded_by: canonical.id,
        review_reason: `auto-deduped: topic cluster ${key} (canonical=${canonical.id.slice(0, 8)})`,
        active: false,
      }).eq("id", l.id);
    }
    supersededCount++;
  }
}
console.log(`  → ${supersededCount} duplicates ${DRY_RUN ? "would be" : ""} marked superseded\n`);

// ─── Pass 2: Stale expiry ─────────────────────────────────────────
const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
console.log(`Pass 2: stale expiry (>${STALE_DAYS} days, cutoff = ${cutoff.slice(0, 10)})`);

// Re-pull pending after Pass 1's superseded updates so we don't double-process
let pendingStill = [];
for (let from = 0; from < 5000; from += 1000) {
  const { data } = await sb.from("campaigns")
    .select("id, title, state, created_at")
    .eq("review_state", "pending_review")
    .eq("auto_generated", true)
    .lt("created_at", cutoff)
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  pendingStill = pendingStill.concat(data);
  if (data.length < 1000) break;
}
console.log(`  ${pendingStill.length} pending campaigns older than ${STALE_DAYS} days`);
for (const p of pendingStill.slice(0, 5)) {
  console.log(`    [${(p.state ?? "?")}] ${(p.created_at ?? "").slice(0, 10)} ${(p.title ?? "").slice(0, 70)}`);
}
if (pendingStill.length > 5) console.log(`    … and ${pendingStill.length - 5} more`);

if (!DRY_RUN && pendingStill.length > 0) {
  // Batch update in chunks of 100
  for (let i = 0; i < pendingStill.length; i += 100) {
    const chunk = pendingStill.slice(i, i + 100).map((r) => r.id);
    await sb.from("campaigns").update({
      review_state: "rejected",
      review_reason: `auto-rejected: stale pending >${STALE_DAYS} days`,
      active: false,
    }).in("id", chunk);
  }
}
console.log(`  → ${pendingStill.length} ${DRY_RUN ? "would be" : ""} auto-rejected as stale\n`);

// ─── Pass 3: FP-derived rejection ────────────────────────────────
console.log(`Pass 3: FP-derived rejection`);
// Find pending campaigns whose linked policy_alert came from an FP news_item.
// Trace: campaigns.id ← policy_alerts.campaign_id, policy_alerts.source_url → news_items.url
const { data: linkedAlerts } = await sb.from("policy_alerts")
  .select("id, campaign_id, source_url")
  .not("campaign_id", "is", null)
  .not("source_url", "is", null)
  .limit(5000);

const fpRejected = [];
if (linkedAlerts && linkedAlerts.length > 0) {
  // Build URL set
  const urls = [...new Set(linkedAlerts.map((a) => a.source_url).filter(Boolean))];
  // Batch-fetch news_items matching those URLs
  const fpUrls = new Set();
  for (let i = 0; i < urls.length; i += 100) {
    const chunk = urls.slice(i, i + 100);
    const { data: ni } = await sb.from("news_items")
      .select("url, body_has_kratom_keyword")
      .in("url", chunk);
    for (const r of ni ?? []) {
      if (r.body_has_kratom_keyword === false) fpUrls.add(r.url);
    }
  }
  console.log(`  found ${fpUrls.size} FP-flagged news URLs linked to alerts`);

  // Pending campaigns whose linked alert's source_url is FP
  for (const a of linkedAlerts) {
    if (!fpUrls.has(a.source_url)) continue;
    fpRejected.push(a.campaign_id);
  }
  // Dedup + filter to pending only
  const ids = [...new Set(fpRejected)];
  if (ids.length > 0) {
    const { data: stillPending } = await sb.from("campaigns")
      .select("id, title, state")
      .in("id", ids)
      .eq("review_state", "pending_review");
    console.log(`  ${stillPending?.length ?? 0} pending campaigns trace to FP-flagged news`);
    if (!DRY_RUN && stillPending && stillPending.length > 0) {
      for (let i = 0; i < stillPending.length; i += 100) {
        const chunk = stillPending.slice(i, i + 100).map((r) => r.id);
        await sb.from("campaigns").update({
          review_state: "rejected",
          review_reason: "auto-rejected: source news flagged FP (body_has_kratom_keyword=false)",
          active: false,
        }).in("id", chunk);
      }
    }
    console.log(`  → ${stillPending?.length ?? 0} ${DRY_RUN ? "would be" : ""} auto-rejected as FP-derived`);
  }
}

// ─── Final report ────────────────────────────────────────────────
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const { count: pendingNow } = await sb.from("campaigns")
  .select("id", { count: "exact", head: true })
  .eq("review_state", "pending_review")
  .eq("auto_generated", true);

console.log(`\nDone in ${elapsed}s`);
console.log(`Pending auto campaigns ${DRY_RUN ? "(unchanged, dry run)" : "now"}: ${pendingNow}`);

try {
  await sb.from("scraper_runs").insert({
    source: "cleanup_pending_campaigns",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: supersededCount + pendingStill.length + fpRejected.length,
    notes: `superseded=${supersededCount} stale-rejected=${pendingStill.length} fp-rejected=${fpRejected.length} mode=${DRY_RUN ? "dry" : "live"}`,
  });
} catch { /* best-effort */ }
