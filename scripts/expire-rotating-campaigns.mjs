#!/usr/bin/env node
/**
 * Rotating-campaign expiry janitor (owner timeout model, 2026-06-22).
 *
 * STANDING campaigns (is_standing=true — the per-state evergreens) NEVER expire.
 * ROTATING auto-generated campaigns ride a timer: a 90-day shelf life, but they
 * only retire once they are ALSO 60-day-quiet (no action in 60d). Zero actions
 * alone is NOT a death signal — a state may have no users yet — so the quiet
 * gate protects a still-relevant campaign from being auto-retired.
 *
 * Scope: only ORPHAN rotating campaigns (bill_id IS NULL — pure news/solidarity).
 * Bill-linked campaigns are governed by their bill's status via
 * cleanup-stale-active-campaigns.mjs; we don't double-judge them here.
 *
 * Two passes (dry-run default; --apply to commit):
 *   1. STAMP — set ends_at = created + 90d on auto_generated, non-standing,
 *      active campaigns missing an ends_at (gives every rotating campaign a
 *      visible timeout date).
 *   2. RETIRE — deactivate orphan rotating campaigns that are >90d old AND have
 *      had 0 actions in the last 60d. Sets active=false + review_reason. Never
 *      touches is_standing, manual, or bill-linked campaigns.
 *   3. RECONCILE — deactivate orphans whose source alerts (policy_alerts.
 *      campaign_id) were ALL rejected by moderation (justification gone),
 *      regardless of age. Engagement guard: keep any that ever had an action.
 *
 *   node --env-file=.env.local scripts/expire-rotating-campaigns.mjs           # dry-run
 *   node --env-file=.env.local scripts/expire-rotating-campaigns.mjs --apply
 *   node --env-file=.env.local scripts/expire-rotating-campaigns.mjs --apply --shelf-days 90 --quiet-days 60
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? parseInt(args[i + 1], 10) || d : d; };
const SHELF_DAYS = arg("--shelf-days", 90);
const QUIET_DAYS = arg("--quiet-days", 60);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const now = Date.now();
const shelfCut = new Date(now - SHELF_DAYS * 86_400_000).toISOString();
const quietCut = new Date(now - QUIET_DAYS * 86_400_000).toISOString();

console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — rotating-campaign expiry (shelf ${SHELF_DAYS}d, quiet ${QUIET_DAYS}d)\n`);

// ── Pass 1: stamp ends_at on rotating campaigns missing one ──────────
const { data: needStamp } = await sb.from("campaigns")
  .select("id, created_at")
  .eq("active", true).eq("auto_generated", true).eq("is_standing", false).is("ends_at", null);
console.log(`Pass 1 — stamp ends_at: ${needStamp?.length ?? 0} rotating campaigns missing a timeout date`);
if (APPLY) {
  let stamped = 0;
  for (const c of needStamp ?? []) {
    const ends = new Date(new Date(c.created_at).getTime() + SHELF_DAYS * 86_400_000).toISOString();
    const { error } = await sb.from("campaigns").update({ ends_at: ends }).eq("id", c.id).is("ends_at", null);
    if (!error) stamped++;
  }
  console.log(`  → stamped ${stamped}`);
}

// ── Pass 2: retire orphan rotating campaigns that are old AND quiet ──
const { data: candidates } = await sb.from("campaigns")
  .select("id, slug, state, title, created_at")
  .eq("active", true).eq("auto_generated", true).eq("is_standing", false)
  .is("bill_id", null).lt("created_at", shelfCut);
console.log(`\nPass 2 — retire old+quiet orphans: ${candidates?.length ?? 0} orphan rotating campaigns older than ${SHELF_DAYS}d`);

// which of them had ANY action in the quiet window
const ids = (candidates ?? []).map((c) => c.id);
const recentlyActive = new Set();
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  if (!chunk.length) break;
  const { data } = await sb.from("campaign_actions").select("campaign_id").in("campaign_id", chunk).gte("sent_at", quietCut);
  for (const r of data ?? []) recentlyActive.add(r.campaign_id);
}
const toRetire = (candidates ?? []).filter((c) => !recentlyActive.has(c.id));
console.log(`  ${recentlyActive.size} still active in last ${QUIET_DAYS}d (kept) · ${toRetire.length} old+quiet → retire`);
for (const c of toRetire.slice(0, 12)) console.log(`     [${c.state ?? "--"}] ${(c.created_at || "").slice(0, 10)} ${(c.title || "").slice(0, 60)}`);
if (toRetire.length > 12) console.log(`     … and ${toRetire.length - 12} more`);

let retired = 0;
if (APPLY && toRetire.length) {
  for (let i = 0; i < toRetire.length; i += 100) {
    const chunk = toRetire.slice(i, i + 100).map((c) => c.id);
    const { data, error } = await sb.from("campaigns")
      .update({ active: false, review_reason: `auto-retired: rotating campaign >${SHELF_DAYS}d old + ${QUIET_DAYS}d quiet (expire-rotating-campaigns)`, reviewed_at: new Date().toISOString() })
      .in("id", chunk).eq("active", true).eq("is_standing", false).is("bill_id", null).select("id");
    if (error) { console.error(`  chunk failed: ${error.message}`); continue; }
    retired += data?.length ?? 0;
  }
  console.log(`  → retired ${retired}`);
}

// ── Pass 3: reconcile orphans whose source alerts were ALL rejected ──
// Fable-flag reconcile (2026-07-02): the auto_campaign_on_alert engine can
// leave an orphan active after ALL its source alerts (linked via
// policy_alerts.campaign_id) were rejected by moderation — the campaign's
// entire justification is gone. Deactivate those, regardless of age. Engagement
// guard: keep any orphan that has EVER had an action (someone cared → let the
// age-based Pass 2 shelf govern it instead of yanking it here).
const { data: liveOrphans } = await sb.from("campaigns")
  .select("id, slug, state, title")
  .eq("active", true).eq("auto_generated", true).eq("is_standing", false).is("bill_id", null);
const orphanIds = (liveOrphans ?? []).map((c) => c.id);
const alertStatusByCamp = new Map();
const everActioned = new Set();
for (let i = 0; i < orphanIds.length; i += 200) {
  const chunk = orphanIds.slice(i, i + 200);
  if (!chunk.length) break;
  const { data: al } = await sb.from("policy_alerts").select("campaign_id, moderation_status").in("campaign_id", chunk);
  for (const a of al ?? []) {
    if (!alertStatusByCamp.has(a.campaign_id)) alertStatusByCamp.set(a.campaign_id, []);
    alertStatusByCamp.get(a.campaign_id).push(a.moderation_status);
  }
  const { data: act } = await sb.from("campaign_actions").select("campaign_id").in("campaign_id", chunk);
  for (const r of act ?? []) everActioned.add(r.campaign_id);
}
const rejectedOrphans = (liveOrphans ?? []).filter((c) => {
  const st = alertStatusByCamp.get(c.id);
  return st && st.length > 0 && st.every((s) => s === "rejected") && !everActioned.has(c.id);
});
console.log(`\nPass 3 — reconcile all-rejected-alert orphans: ${rejectedOrphans.length} (every source alert rejected + 0 actions)`);
for (const c of rejectedOrphans.slice(0, 12)) console.log(`     [${c.state ?? "--"}] ${(c.title || c.slug || "").slice(0, 60)}`);
if (rejectedOrphans.length > 12) console.log(`     … and ${rejectedOrphans.length - 12} more`);

let reconciled = 0;
if (APPLY && rejectedOrphans.length) {
  for (let i = 0; i < rejectedOrphans.length; i += 100) {
    const chunk = rejectedOrphans.slice(i, i + 100).map((c) => c.id);
    const { data, error } = await sb.from("campaigns")
      .update({ active: false, review_reason: "auto-reconciled: all source alerts rejected + 0 actions (expire-rotating-campaigns Pass 3)", reviewed_at: new Date().toISOString() })
      .in("id", chunk).eq("active", true).eq("is_standing", false).is("bill_id", null).select("id");
    if (error) { console.error(`  chunk failed: ${error.message}`); continue; }
    reconciled += data?.length ?? 0;
  }
  console.log(`  → reconciled ${reconciled}`);
}

if (APPLY) {
  try {
    await sb.from("scraper_runs").insert({ source: "expire_rotating_campaigns", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status: "success", rows_updated: retired + reconciled, notes: `stamped=${needStamp?.length ?? 0} retired=${retired} reconciled=${reconciled} kept_active=${recentlyActive.size}` });
  } catch { /* best-effort */ }
} else {
  console.log(`\n(dry-run — re-run with --apply to commit.)`);
}
console.log(`Done in ${((now - t0) / 1000 + (Date.now() - now) / 1000).toFixed(1)}s`);
