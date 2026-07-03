#!/usr/bin/env node
/**
 * clear-review-queues.mjs — the liveness/quality fact-check the existing queue
 * automation is missing.
 *
 * WHAT ALREADY EXISTS (don't rebuild — see docs/RUNBOOK_review_queues.md):
 *   - auto-approve-campaigns.mjs   (hourly)  approve/supersede high-confidence,
 *                                            ESCALATE ambiguous to the human queue,
 *                                            reject OFF by default.
 *   - cleanup-pending-campaigns.mjs (daily)  topic-cluster collapse + 45d-stale reject.
 *   - dedupe-pending-alerts.mjs     (daily)  intel-queue cluster collapse.
 *   - reject-wrongstate-pending-alerts.mjs (daily) geo-mismatch reject (title vs locality).
 *
 * THE GAP this fills: items the engine ESCALATES and the janitors don't catch —
 * news-derived campaigns/alerts about bills that are already DEAD or ENACTED
 * (so action is moot), that DON'T EXIST (AI-scraper hallucinations), whose
 * geo-tag is wrong, or that name a specific politician (nonpartisan risk). These
 * sit in pending_review forever because reject is off and nothing checks liveness.
 * This grounds each survivor with a keyless web search (SearXNG, on the box) and a
 * FREE-tier AI verdict (aiRouter — never Claude), then auto-REJECTS the clearly-bad
 * ones (reversible) and leaves the genuine + ambiguous ones for the human/engine.
 * It NEVER auto-approves (approval fires user notifications — that stays with the
 * engine or a human).
 *
 * Safe by construction: dry-run default; only rejects on medium/high confidence
 * WITH web evidence; every write is audit-logged + scraper_runs-tracked; rejects
 * are undoable (reactivateRejectedCampaigns / re-approve intel).
 *
 *   node --env-file=.env.local scripts/clear-review-queues.mjs                 # list + heuristics only
 *   node --env-file=.env.local scripts/clear-review-queues.mjs --ai            # + grounded fact-check (dry-run)
 *   node --env-file=.env.local scripts/clear-review-queues.mjs --ai --apply    # commit the rejects
 *   node --env-file=.env.local scripts/clear-review-queues.mjs --ai --apply --actor <owner-uuid>
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";
import { searxngSearch, searxngConfigured } from "./lib/searxng.mjs";
import { REJECT_COLUMNS } from "./lib/campaign-review-columns.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";

const args = process.argv.slice(2);
const AI = args.includes("--ai");
const APPLY = args.includes("--apply");
const ACTOR = (() => { const i = args.indexOf("--actor"); return i >= 0 ? args[i + 1] : null; })();
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? parseInt(args[i + 1], 10) || 200 : 200; })();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SYSTEM = `You fact-check pending items for iKratom, a strictly NONPARTISAN kratom-advocacy platform. Each item is a scraped news headline that became either a public /pulse news post (intel) or a campaign that mobilizes constituents to email legislators. Items are AI-generated and may be stale, mis-tagged, or hallucinated. Using ONLY the web-search snippets provided, decide KEEP or REJECT.
REJECT when the snippets show any of: the bill/action is already DEAD (died/tabled/failed/sine die) or already fully ENACTED/SIGNED into law (so constituent action is moot), the described event does NOT appear to exist (hallucination), the location is wrong for the tagged state, OR the item is framed around a specific named politician/party (partisan). Otherwise KEEP. A bill that has only PASSED ONE CHAMBER is still LIVE in the other chamber — KEEP it (only signed-into-law/enacted or died/failed is terminal). If the snippets are thin, contradictory, or merely duplicate a still-current story, KEEP (dedup and approval are handled elsewhere; a human will review).
Reply with ONLY compact JSON: {"verdict":"keep"|"reject","confidence":"high"|"medium"|"low","reason":"<=180 chars, cite what the snippets showed"}.`;

async function classify(kind, title, state, snippets) {
  if (!snippets.length) return { verdict: "keep", confidence: "low", reason: "no web evidence — left for human review" };
  const ev = snippets.slice(0, 5).map((s, i) => `[${i + 1}] ${s.title} — ${s.content}`.slice(0, 320)).join("\n");
  const user = `TYPE: ${kind}\nTITLE: ${title}\nTAGGED LOCATION: ${state || "FED/national"}\nTODAY: ${new Date().toISOString().slice(0, 10)}\n\nWEB SNIPPETS:\n${ev}`;
  try {
    const { parsed } = await aiRouter({ systemPrompt: SYSTEM, userPrompt: user, maxTokens: 300 });
    const v = String(parsed?.verdict || "").toLowerCase() === "reject" ? "reject" : "keep";
    const c = ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "low";
    return { verdict: v, confidence: c, reason: String(parsed?.reason || "").slice(0, 300) };
  } catch (e) {
    return { verdict: "keep", confidence: "low", reason: `AI error, kept: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function audit(action, targetType, targetId, reason) {
  try {
    await sb.from("admin_audit_log").insert({
      actor_id: ACTOR, actor_email: "system:clear-review-queues.mjs",
      action, target_type: targetType, target_id: targetId,
      details: { reason, via: "clear-review-queues.mjs" },
    });
  } catch { /* never block the reject on audit failure */ }
}

await runWithLogging({ source: "clear_review_queues", supabase: sb }, async () => {
  console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — clear-review-queues${AI ? " (AI liveness fact-check)" : " (list only)"}`);
  console.log(`SearXNG grounding: ${searxngConfigured() ? "configured" : "OFF (set SEARXNG_URL; without it every item is kept for human review)"}\n`);

  // ── Pending intel (policy_alerts) ─────────────────────────────────────────
  const { data: intel = [] } = await sb.from("policy_alerts")
    .select("id, kind, title, locality, source_url, created_at")
    .eq("moderation_status", "pending").order("created_at", { ascending: false }).limit(LIMIT);
  // ── Pending campaigns ─────────────────────────────────────────────────────
  const { data: camps = [] } = await sb.from("campaigns")
    .select("id, title, state, slug, bill_id, mobilization_type, created_at")
    .eq("review_state", "pending_review").order("created_at", { ascending: false }).limit(LIMIT);

  console.log(`Intel queue pending: ${intel.length}    Campaign queue pending: ${camps.length}`);
  if (!AI) {
    for (const a of intel) console.log(`  intel   [${a.locality || "??"}] ${a.title.slice(0, 90)}`);
    for (const c of camps) console.log(`  campaign[${c.state || "FED"}] ${c.title.slice(0, 90)}`);
    console.log(`\nRe-run with --ai to fact-check liveness/geo/hallucination and (with --apply) reject the junk.`);
    return { rowsAdded: 0, rowsUpdated: 0, notes: `dry list: ${intel.length} intel / ${camps.length} campaigns` };
  }

  let rejected = 0;
  const decide = async (row, kind, title, state) => {
    const hits = await searxngSearch(`${title} ${state || ""} kratom`, { count: 6 });
    const d = await classify(kind, title, state, hits);
    const auto = d.verdict === "reject" && (d.confidence === "high" || d.confidence === "medium") && hits.length > 0;
    console.log(`  ${auto ? "❌ REJECT" : "•  keep  "} [${state || "FED"}] ${title.slice(0, 70)} — ${d.confidence}: ${d.reason.slice(0, 120)}`);
    return { auto, reason: d.reason };
  };

  // Campaigns
  const cDecisions = await pool(camps, 4, (c) => decide(c, "campaign", c.title, c.state));
  for (let i = 0; i < camps.length; i++) {
    if (!cDecisions[i].auto) continue;
    const reason = `Auto-rejected (clear-review-queues, ${new Date().toISOString().slice(0, 10)}): ${cDecisions[i].reason}`;
    if (APPLY) {
      const { data } = await sb.from("campaigns")
        .update({ ...REJECT_COLUMNS, reviewed_at: new Date().toISOString(), reviewed_by: ACTOR, review_reason: reason.slice(0, 500) })
        .eq("id", camps[i].id).eq("review_state", "pending_review").select("id");
      if (data?.length) { await audit("campaign_review_rejected", "campaign", camps[i].id, cDecisions[i].reason); rejected++; }
    } else rejected++;
  }

  // Intel
  const iDecisions = await pool(intel, 4, (a) => decide(a, "intel", a.title, a.locality));
  for (let i = 0; i < intel.length; i++) {
    if (!iDecisions[i].auto) continue;
    const reason = `Auto-rejected (clear-review-queues, ${new Date().toISOString().slice(0, 10)}): ${iDecisions[i].reason}`;
    if (APPLY) {
      const { data } = await sb.from("policy_alerts")
        .update({ moderation_status: "rejected", moderated_by: ACTOR, moderated_at: new Date().toISOString(), moderation_note: reason.slice(0, 500) })
        .eq("id", intel[i].id).eq("moderation_status", "pending").select("id");
      if (data?.length) { await audit("intel_tip_rejected", "policy_alert", intel[i].id, iDecisions[i].reason); rejected++; }
    } else rejected++;
  }

  console.log(`\n${APPLY ? "Rejected" : "Would reject"} ${rejected} junk item(s). Survivors stay in queue for the auto-approve engine / human.`);
  return { rowsAdded: 0, rowsUpdated: APPLY ? rejected : 0, notes: `${AI ? "ai" : "list"} run; ${rejected} ${APPLY ? "rejected" : "flagged"}` };
});
