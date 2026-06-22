#!/usr/bin/env node
/**
 * One-shot resolution of the 2026-06-22 pending-queue audit (28 campaigns +
 * 42 intel alerts), adversarially verified by the campaign-intel-audit workflow.
 *
 * Campaign transitions use the EXACT columns the app's manual/bulk review path
 * writes (src/modules/admin/campaign-review-shared.ts):
 *   approve   → { active:true,  review_state:'auto_active' }
 *   supersede → { active:false, review_state:'superseded', superseded_by:<id> }
 *   reject    → { active:false, review_state:'rejected' }
 * Every campaign update is guarded with .eq('review_state','pending_review').
 *
 * Intel transitions set moderation_status approved|rejected (+ moderated_at,
 * moderation_note), guarded with .eq('moderation_status','pending'). Approving
 * an action_required alert may fire auto_campaign_on_alert() for genuine
 * ban/schedule items — the ux_campaigns_topic_key_live index dedups collisions.
 *
 *   node --env-file=.env.local scripts/resolve-queue-audit-2026-06-22.mjs            # dry-run
 *   node --env-file=.env.local scripts/resolve-queue-audit-2026-06-22.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const dumpIdx = process.argv.indexOf("--dump");
const DUMP = dumpIdx >= 0 ? process.argv[dumpIdx + 1]
  : "C:/Users/USER~1.ADA/AppData/Local/Temp/claude/C--claude-ikratom/84e8bb40-5fc8-4f90-86e8-a3f0e4fe4465/scratchpad";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const REASON = "Audit 2026-06-22 (campaign-intel-audit workflow, adversarially verified)";

// ── Campaign verdicts (by slug) ──────────────────────────────────────
const KEEP = [
  "alert-mi-mi-hb-5537-passed-by-house-72bdff",
  "alert-mt-riverstone-health-in-billings-to-enforce-4b5a79",
  "alert-de-delaware-bill-to-regulate-kratom-clears-ba4905",
  "stop-ny-s03426",
];
const SUPERSEDE = {
  "alert-ky-addictive-kratom-byproduct-could-become-a-10a1cd": "alert-ky-ky-moving-toward-making-forms-of-4fecde",
  "alert-ky-kratom-what-it-is-and-why-9a5de8": "alert-ky-ky-moving-toward-making-forms-of-4fecde",
  "alert-nj-gas-station-heroin-crackdown-moves-forward-8b2b38": "stop-nj-a1203",
  "alert-nj-bill-to-classify-synthetic-kratom-compound-09e14c": "alert-nj-nj-lawmaker-introduces-bill-to-ban-460ff4",
  "alert-ga-georgia-lawmakers-discuss-ways-to-regulate-2e3daa": "stop-ga-hb968",
  "alert-mo-lawmakers-consider-bills-on-7-oh-and-4afb3f": "alert-mo-missouri-lawmaker-hopes-to-regulate-products-24a69c",
  "alert-ct-connecticut-lawmakers-cracking-down-on-sale-5c1146": "alert-ct-kratom-6-other-substances-now-designated-a9a953",
};
const REJECT = [
  "alert-tx-tx-sb-1868-reported-engrossed-a50d69", "alert-ok-ok-sb-860-engrossed-to-house-9e718e",
  "alert-ut-former-addict-warns-of-gas-station-95bac8", "alert-or-why-2-more-states-will-soon-86139b",
  "alert-hi-why-2-more-states-will-soon-367621", "alert-al-why-2-more-states-will-soon-e7a0a2",
  "alert-md-why-2-more-states-will-soon-cdbda1", "alert-ar-doctors-call-kratom-the-next-addiction-5ed8e7",
  "alert-pa-pennsylvania-house-passes-bill-banning-gas-edfde7", "alert-ak-why-2-more-states-will-soon-12600a",
  "alert-all-testimony-re-ab-1088-kratom-regulation-dc9266", "alert-co-why-2-more-states-will-soon-252942",
  "alert-ok-why-2-more-states-will-soon-8dd9d4", "alert-sc-pickens-county-teens-urge-local-ban-63f9e7",
  "alert-al-alabama-board-of-pharmacy-urges-caution-3dc684", "alert-az-arizonas-small-businesses-could-become-collateral-5e135c",
  "alert-nm-kratom-compound-to-be-regulated-due-74f1ac",
];

// ── Intel verdicts (by 1-based position in intel-queue.json) ─────────
const INTEL_APPROVE = new Set([2,3,4,5,7,10,11,12,13,14,15,17,18,19,21,23,25,26,28,33,34,35,36,37,40,41]);
const INTEL_REJECT  = new Set([1,6,8,9,16,20,22,24,27,29,30,31,32,38,39,42]);

console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — resolve audit 2026-06-22\n`);

// ===== CAMPAIGNS =====
const allSlugs = [...KEEP, ...Object.keys(SUPERSEDE), ...REJECT];
if (allSlugs.length !== 28) throw new Error(`expected 28 campaign slugs, got ${allSlugs.length}`);
const targetSlugs = [...new Set(Object.values(SUPERSEDE))];

const { data: pend } = await sb.from("campaigns").select("id, slug, review_state, active").in("slug", allSlugs);
const { data: targets } = await sb.from("campaigns").select("id, slug, active").in("slug", targetSlugs);
const idBySlug = Object.fromEntries((pend ?? []).map((c) => [c.slug, c.id]));
const targetIdBySlug = Object.fromEntries((targets ?? []).map((c) => [c.slug, c.id]));

// Preflight validation
const missing = allSlugs.filter((s) => !idBySlug[s]);
const notPending = (pend ?? []).filter((c) => c.review_state !== "pending_review").map((c) => `${c.slug}=${c.review_state}`);
const missingTargets = targetSlugs.filter((s) => !targetIdBySlug[s]);
const inactiveTargets = (targets ?? []).filter((c) => !c.active).map((c) => c.slug);
console.log(`Campaigns matched: ${pend?.length}/28  | supersede targets: ${targets?.length}/${targetSlugs.length}`);
if (missing.length) console.log(`  ⚠ slugs not found: ${missing.join(", ")}`);
if (notPending.length) console.log(`  ⚠ not pending_review (will be skipped by guard): ${notPending.join(", ")}`);
if (missingTargets.length) console.log(`  ⚠ supersede TARGET slugs not found: ${missingTargets.join(", ")}`);
if (inactiveTargets.length) console.log(`  ⚠ supersede targets not active: ${inactiveTargets.join(", ")}`);
console.log(`Plan: keep/approve ${KEEP.length} · supersede ${Object.keys(SUPERSEDE).length} · reject ${REJECT.length}`);

async function tx(ids, patch) {
  if (!ids.length) return 0;
  const { data, error } = await sb.from("campaigns").update(patch).in("id", ids)
    .eq("review_state", "pending_review").select("id");
  if (error) { console.error(`   update failed: ${error.message}`); return 0; }
  return data?.length ?? 0;
}
const stamp = { reviewed_at: new Date().toISOString(), reviewed_by: null, review_reason: REASON };
let cKept = 0, cSup = 0, cRej = 0;
if (APPLY) {
  cKept = await tx(KEEP.map((s) => idBySlug[s]).filter(Boolean), { active: true, review_state: "auto_active", ...stamp });
  for (const [slug, tslug] of Object.entries(SUPERSEDE)) {
    const id = idBySlug[slug], tid = targetIdBySlug[tslug];
    if (!id || !tid) { console.log(`   skip supersede ${slug} (missing id/target)`); continue; }
    cSup += await tx([id], { active: false, review_state: "superseded", superseded_by: tid, ...stamp });
  }
  cRej = await tx(REJECT.map((s) => idBySlug[s]).filter(Boolean), { active: false, review_state: "rejected", ...stamp });
  console.log(`  → approved ${cKept} · superseded ${cSup} · rejected ${cRej}`);
} else {
  console.log("  (dry-run — no campaign writes)");
}

// ===== INTEL =====
console.log("");
const intel = JSON.parse(readFileSync(`${DUMP}/intel-queue.json`, "utf8"));
if (intel.length !== 42) throw new Error(`intel-queue.json has ${intel.length} rows, expected 42 — re-dump before applying`);
const approveIds = [], rejectIds = [];
intel.forEach((row, k) => {
  const i = k + 1;
  if (INTEL_APPROVE.has(i)) approveIds.push(row.id);
  else if (INTEL_REJECT.has(i)) rejectIds.push(row.id);
});
console.log(`Intel: approve ${approveIds.length} · reject ${rejectIds.length} (of ${intel.length})`);

// Which approves are campaign-spawn-eligible (mirror of 0198 gate, for reporting)
const NOISE = /\b(recall|recalls|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz|cease|warn|warning|navy|military)\b/i;
const BANVERB = /\b(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\b/i;
const spawn = intel.filter((r, k) => INTEL_APPROVE.has(k + 1) && (
  ["bill_event", "bop_hearing"].includes(r.kind) ||
  (["fda_action", "dea_action"].includes(r.kind) && !NOISE.test(r.title) && BANVERB.test(r.title))
));
console.log(`  ~${spawn.length} approved alerts are campaign-spawn-eligible (deduped by topic-key index):`);
for (const r of spawn) console.log(`     [${r.kind}/${r.locality}] ${(r.title || "").slice(0, 70)}`);

if (APPLY) {
  const before = (await sb.from("campaigns").select("id", { count: "exact", head: true }).eq("review_state", "pending_review")).count ?? 0;
  let aRej = 0, aApp = 0;
  if (rejectIds.length) {
    const { data } = await sb.from("policy_alerts").update({ moderation_status: "rejected", moderated_at: new Date().toISOString(), moderation_note: REASON + " — duplicate/stale" })
      .in("id", rejectIds).eq("moderation_status", "pending").select("id");
    aRej = data?.length ?? 0;
  }
  if (approveIds.length) {
    const { data } = await sb.from("policy_alerts").update({ moderation_status: "approved", moderated_at: new Date().toISOString(), moderation_note: REASON + " — distinct/canonical" })
      .in("id", approveIds).eq("moderation_status", "pending").select("id");
    aApp = data?.length ?? 0;
  }
  const after = (await sb.from("campaigns").select("id", { count: "exact", head: true }).eq("review_state", "pending_review")).count ?? 0;
  console.log(`  → intel approved ${aApp} · rejected ${aRej}`);
  console.log(`  → pending campaigns spawned by approvals: ${after - before} (was ${before}, now ${after})`);
  try {
    await sb.from("scraper_runs").insert({ source: "resolve_queue_audit_20260622", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), status: "success",
      rows_updated: cKept + cSup + cRej + aApp + aRej, notes: `camp(keep=${cKept},sup=${cSup},rej=${cRej}) intel(app=${aApp},rej=${aRej}) spawned=${after - before}` });
  } catch { /* best-effort */ }
} else {
  console.log("  (dry-run — no intel writes)\n\nRe-run with --apply to commit.");
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
