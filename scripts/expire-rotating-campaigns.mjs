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

if (APPLY) {
  try {
    await sb.from("scraper_runs").insert({ source: "expire_rotating_campaigns", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status: "success", rows_updated: retired, notes: `stamped=${needStamp?.length ?? 0} retired=${retired} kept_active=${recentlyActive.size}` });
  } catch { /* best-effort */ }
} else {
  console.log(`\n(dry-run — re-run with --apply to commit.)`);
}
console.log(`Done in ${((now - t0) / 1000 + (Date.now() - now) / 1000).toFixed(1)}s`);
