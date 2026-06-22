#!/usr/bin/env node
/**
 * Intel-queue cluster-janitor — the missing sibling of cleanup-pending-campaigns.mjs.
 *
 * The campaign review queue has a daily topic-cluster collapse cron; the intel
 * queue (pending policy_alerts) had only the geo-mismatch rejecter, so ONE
 * national story (e.g. the FDA/HHS/DEA 7-OH scheduling push) lands as ~16
 * near-identical alerts from different outlets and piles up for the owner to
 * hand-review. The 2026-06-22 audit cleared 27 of 42 as dupes; this prevents the
 * refill. (auto-approve-campaigns.mjs only back-links policy_alerts.campaign_id —
 * it does NOT moderate the intel queue.)
 *
 * Reuses the canonical clustering primitives in scripts/lib/topic-key.mjs so the
 * intel queue collapses the SAME way the campaign queue does:
 *   • federalTopicKey  — the national FDA/DEA 7-OH push (varied verbs/outlets) → one bucket
 *   • normalizedTitleKey(stripOutlet) — cross-outlet near-identical headlines ("…7-OH - WLOS" == "…7-OH")
 *
 * Three conservative passes (dry-run default; --apply to commit):
 *   A. ALREADY-PUBLIC — reject a pending alert whose story signature matches an
 *      alert already approved in the last 90d (the re-scrape case; the DB's
 *      ux_policy_alerts_dedupe_approved only catches exact dedupe_key at approval).
 *   B. CLUSTER COLLAPSE — group remaining pending by signature; keep the EARLIEST
 *      (first to break the story), reject the rest.
 *   C. STALE — (opt-in via --stale-days N) reject pending alerts older than N days.
 *
 * NEVER auto-rejects AKA / protectkratom advocacy alerts (always high value).
 *
 *   node --env-file=.env.local scripts/dedupe-pending-alerts.mjs            # dry-run
 *   node --env-file=.env.local scripts/dedupe-pending-alerts.mjs --apply
 *   node --env-file=.env.local scripts/dedupe-pending-alerts.mjs --apply --stale-days 45
 */
import { createClient } from "@supabase/supabase-js";
import { federalTopicKey, normalizedTitleKey } from "./lib/topic-key.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const staleIdx = args.indexOf("--stale-days");
const STALE_DAYS = staleIdx >= 0 ? parseInt(args[staleIdx + 1], 10) || 0 : 0;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const PAGE = 1000;

const isAka = (a) => String(a.dedupe_key || "").startsWith("protectkratom:");
// Drop a trailing " - Outlet Name" (the common syndication suffix) so two
// outlets' copies of one headline share a signature. Leaves bare titles alone.
function stripOutlet(title) {
  const s = String(title || "");
  const i = s.lastIndexOf(" - ");
  return i > 20 ? s.slice(0, i) : s; // only strip if there's a real headline before it
}
function storySig(a) {
  const fed = federalTopicKey(a.locality, a.title);
  if (fed) return fed;                                   // national 7-OH push → one bucket
  return normalizedTitleKey(stripOutlet(a.title));       // near-identical cross-outlet headline
}

console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — intel-queue dedupe janitor${STALE_DAYS ? ` (stale>${STALE_DAYS}d)` : ""}\n`);

// Pull all pending alerts
let pending = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await sb.from("policy_alerts")
    .select("id, title, locality, dedupe_key, source_url, kind, created_at")
    .eq("moderation_status", "pending").order("created_at", { ascending: true }).range(from, from + PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data?.length) break;
  pending = pending.concat(data);
  if (data.length < PAGE) break;
}
console.log(`pending alerts: ${pending.length}`);
const akaCount = pending.filter(isAka).length;
if (akaCount) console.log(`  (${akaCount} AKA/advocacy alerts — never auto-rejected)`);

const rejectIds = new Set();
const reasons = new Map();
const flag = (id, why) => { if (!rejectIds.has(id)) { rejectIds.add(id); reasons.set(id, why); } };

// ── Pass A: pending whose story is already approved/public ───────────
const cutoff90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
let approved = [];
for (let from = 0; ; from += PAGE) {
  const { data } = await sb.from("policy_alerts")
    .select("id, title, locality, dedupe_key, created_at")
    .eq("moderation_status", "approved").gte("created_at", cutoff90).range(from, from + PAGE - 1);
  if (!data?.length) break;
  approved = approved.concat(data);
  if (data.length < PAGE) break;
}
const approvedSigs = new Set(approved.map(storySig));
let passA = 0;
for (const a of pending) {
  if (isAka(a)) continue;
  if (approvedSigs.has(storySig(a))) { flag(a.id, "already-public: story matches an approved alert"); passA++; }
}
console.log(`\nPass A — already-public re-scrapes: ${passA}  (against ${approved.length} approved alerts, 90d)`);

// ── Pass B: cluster remaining pending; keep earliest ─────────────────
const clusters = new Map();
for (const a of pending) {
  if (isAka(a) || rejectIds.has(a.id)) continue;
  const k = storySig(a);
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(a);
}
const multi = [...clusters.entries()].filter(([, v]) => v.length > 1);
let passB = 0;
for (const [, rows] of multi) {
  rows.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")); // earliest first
  const keeper = rows.find((r) => r.source_url) || rows[0]; // prefer one with a source link, else earliest
  for (const r of rows) if (r.id !== keeper.id) { flag(r.id, `dupe of ${keeper.id.slice(0, 8)} (${storySig(r)})`); passB++; }
}
console.log(`Pass B — cluster collapse: ${multi.length} multi-clusters, ${passB} dupes`);
for (const [k, rows] of multi.slice(0, 12)) console.log(`   ×${rows.length} [${k}] ${(rows[0].title || "").slice(0, 60)}`);

// ── Pass C: stale (opt-in) ───────────────────────────────────────────
let passC = 0;
if (STALE_DAYS > 0) {
  const staleCut = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  for (const a of pending) {
    if (isAka(a) || rejectIds.has(a.id)) continue;
    if ((a.created_at || "") < staleCut) { flag(a.id, `stale: pending >${STALE_DAYS}d`); passC++; }
  }
  console.log(`Pass C — stale >${STALE_DAYS}d: ${passC}`);
}

const ids = [...rejectIds];
console.log(`\nTotal to reject: ${ids.length} of ${pending.length} pending  (keeps ${pending.length - ids.length})`);

if (APPLY && ids.length) {
  let done = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await sb.from("policy_alerts")
      .update({ moderation_status: "rejected", moderated_at: new Date().toISOString(), moderation_note: "auto-deduped (dedupe-pending-alerts janitor)" })
      .in("id", chunk).eq("moderation_status", "pending").select("id");
    if (error) { console.error(`  chunk failed: ${error.message}`); continue; }
    done += data?.length ?? 0;
  }
  console.log(`\n✅ Rejected ${done} duplicate/stale pending alerts.`);
  try {
    await sb.from("scraper_runs").insert({ source: "dedupe_pending_alerts", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status: "success", rows_updated: done, notes: `A(public)=${passA} B(cluster)=${passB} C(stale)=${passC}` });
  } catch { /* best-effort */ }
} else if (ids.length) {
  console.log(`\n(dry-run — re-run with --apply to reject these.)`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
