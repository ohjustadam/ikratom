#!/usr/bin/env node
/**
 * clear-review-queues.mjs — the liveness/quality fact-check the existing queue
 * automation is missing, now with optional FULL AUTONOMY (--approve).
 *
 * WHAT ALREADY EXISTS (don't rebuild — see docs/RUNBOOK_review_queues.md):
 *   - auto-approve-campaigns.mjs   (hourly)  approve/supersede high-confidence,
 *                                            ESCALATE ambiguous, reject OFF.
 *   - cleanup-pending-campaigns.mjs (daily)  topic-cluster collapse + 45d-stale.
 *   - dedupe-pending-alerts.mjs     (daily)  intel-queue cluster collapse.
 *   - reject-wrongstate-pending-alerts.mjs (daily) geo-mismatch reject.
 *
 * THE GAP this fills: items the engine ESCALATES and the janitors don't catch —
 * news-derived campaigns/alerts about bills already DEAD or ENACTED (moot), that
 * DON'T EXIST (hallucinations), wrong-geo, or partisan. This grounds each survivor
 * with a keyless web search (SearXNG, on the box) + a FREE-tier AI verdict
 * (aiRouter — NEVER Claude), then acts:
 *   default        → REJECT the clearly-bad ones (reversible, audit-logged).
 *   with --approve → ALSO auto-APPROVE the confidently-real+live+on-mission ones
 *                    (campaigns fire the same user-notification trigger as a manual
 *                    approve; intel publishes to /pulse as news). This is the
 *                    zero-click "never anything in queue" autonomy — gated to HIGH
 *                    confidence + web evidence, capped per run, and it honors the
 *                    site_config read_only_mode / emergency_mode kill switches.
 *
 * Uncertain items are always LEFT for the next pass / a human — the unattended
 * path never blind-rejects or blind-approves a low-confidence item.
 *
 *   node --env-file=.env.local scripts/clear-review-queues.mjs                    # list only
 *   node --env-file=.env.local scripts/clear-review-queues.mjs --ai               # + fact-check (dry-run)
 *   node --env-file=.env.local scripts/clear-review-queues.mjs --ai --apply       # commit rejects
 *   node --env-file=.env.local scripts/clear-review-queues.mjs --ai --apply --approve   # full autonomy
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";
import { searxngSearch, searxngConfigured } from "./lib/searxng.mjs";
import { REJECT_COLUMNS, APPROVE_COLUMNS } from "./lib/campaign-review-columns.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";

const args = process.argv.slice(2);
const AI = args.includes("--ai");
const APPLY = args.includes("--apply");
const APPROVE = args.includes("--approve");
const ACTOR = (() => { const i = args.indexOf("--actor"); return i >= 0 ? args[i + 1] : null; })();
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? parseInt(args[i + 1], 10) || 200 : 200; })();
const APPROVE_CAP = (() => { const i = args.indexOf("--approve-cap"); return i >= 0 ? parseInt(args[i + 1], 10) || 20 : 20; })();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SYSTEM = `You fact-check pending items for iKratom, a strictly NONPARTISAN kratom-advocacy platform. Each item is a scraped news headline that became either a public /pulse news post (intel) or a campaign that mobilizes constituents to email legislators. Items are AI-generated and may be stale, mis-tagged, or hallucinated. Using ONLY the web-search snippets provided, return one verdict.
REJECT when the snippets show any of: the bill/action is already DEAD (died/tabled/failed/sine die) or already fully ENACTED/SIGNED into law (so action is moot), the described event does NOT appear to exist (hallucination), the location is wrong for the tagged state, OR the item is framed around a specific named politician/party (partisan).
APPROVE when the snippets confirm the event is real, current, correctly located, nonpartisan, AND any bill is still LIVE (a bill that only passed ONE chamber is still live; only signed-into-law/enacted or died/failed is terminal).
KEEP when the snippets are thin, contradictory, or merely duplicate a still-current story (dedup + approval are handled elsewhere; a human will review).
Reply with ONLY compact JSON: {"verdict":"approve"|"reject"|"keep","confidence":"high"|"medium"|"low","reason":"<=180 chars, cite what the snippets showed"}.`;

async function classify(kind, title, state, snippets) {
  if (!snippets.length) return { verdict: "keep", confidence: "low", reason: "no web evidence — left for human review" };
  const ev = snippets.slice(0, 5).map((s, i) => `[${i + 1}] ${s.title} — ${s.content}`.slice(0, 320)).join("\n");
  const user = `TYPE: ${kind}\nTITLE: ${title}\nTAGGED LOCATION: ${state || "FED/national"}\nTODAY: ${new Date().toISOString().slice(0, 10)}\n\nWEB SNIPPETS:\n${ev}`;
  try {
    const { parsed } = await aiRouter({ systemPrompt: SYSTEM, userPrompt: user, maxTokens: 300 });
    const v = ["approve", "reject", "keep"].includes(parsed?.verdict) ? parsed.verdict : "keep";
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
  } catch { /* never block the write on audit failure */ }
}

// Kill switch: never auto-APPROVE (which fires user notifications) while the site
// is in read-only / emergency mode. Best-effort — if the read fails, no approvals.
async function approvalsAllowed() {
  if (!APPROVE) return false;
  try {
    const { data } = await sb.from("site_config").select("read_only_mode, emergency_mode").limit(1).maybeSingle();
    if (data?.read_only_mode || data?.emergency_mode) { console.log("⚠ read_only/emergency mode — skipping auto-approve"); return false; }
  } catch { return false; }
  return true;
}

await runWithLogging({ source: "clear_review_queues", supabase: sb }, async () => {
  const canApprove = await approvalsAllowed();
  console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — clear-review-queues${AI ? " (AI fact-check)" : " (list only)"}${canApprove ? " +AUTO-APPROVE" : ""}`);
  console.log(`SearXNG grounding: ${searxngConfigured() ? "configured" : "OFF (set SEARXNG_URL; without it every item is kept)"}\n`);

  const { data: intel = [] } = await sb.from("policy_alerts")
    .select("id, kind, title, locality, source_url, created_at")
    .eq("moderation_status", "pending").order("created_at", { ascending: false }).limit(LIMIT);
  const { data: camps = [] } = await sb.from("campaigns")
    .select("id, title, state, slug, bill_id, mobilization_type, created_at")
    .eq("review_state", "pending_review").order("created_at", { ascending: false }).limit(LIMIT);

  console.log(`Intel queue pending: ${intel.length}    Campaign queue pending: ${camps.length}`);
  if (!AI) {
    for (const a of intel) console.log(`  intel   [${a.locality || "??"}] ${a.title.slice(0, 90)}`);
    for (const c of camps) console.log(`  campaign[${c.state || "FED"}] ${c.title.slice(0, 90)}`);
    console.log(`\nRe-run with --ai (+ --apply, + --approve for full autonomy) to act.`);
    return { rowsAdded: 0, rowsUpdated: 0, notes: `dry list: ${intel.length} intel / ${camps.length} campaigns` };
  }

  let rejected = 0, approved = 0, approveBudget = APPROVE_CAP;
  const now = () => new Date().toISOString();

  const decide = async (title, state) => {
    const hits = await searxngSearch(`${title} ${state || ""} kratom`, { count: 6 });
    const d = await classify("item", title, state, hits);
    const canReject = d.verdict === "reject" && (d.confidence === "high" || d.confidence === "medium") && hits.length > 0;
    const canApproveItem = canApprove && d.verdict === "approve" && d.confidence === "high" && hits.length > 0;
    return { ...d, canReject, canApproveItem };
  };

  // Campaigns
  const cd = await pool(camps, 4, (c) => decide(c.title, c.state));
  for (let i = 0; i < camps.length; i++) {
    const d = cd[i], c = camps[i];
    if (d.canApproveItem && approveBudget > 0) {
      console.log(`  ✅ APPROVE [${c.state || "FED"}] ${c.title.slice(0, 66)} — ${d.reason.slice(0, 100)}`);
      if (APPLY) {
        const { data } = await sb.from("campaigns").update({ ...APPROVE_COLUMNS, reviewed_at: now(), reviewed_by: ACTOR })
          .eq("id", c.id).eq("review_state", "pending_review").select("id");
        if (data?.length) { await audit("campaign_review_approved", "campaign", c.id, d.reason); approved++; approveBudget--; }
      } else { approved++; approveBudget--; }
    } else if (d.canReject) {
      console.log(`  ❌ REJECT  [${c.state || "FED"}] ${c.title.slice(0, 66)} — ${d.reason.slice(0, 100)}`);
      const reason = `Auto-rejected (clear-review-queues, ${now().slice(0, 10)}): ${d.reason}`;
      if (APPLY) {
        const { data } = await sb.from("campaigns").update({ ...REJECT_COLUMNS, reviewed_at: now(), reviewed_by: ACTOR, review_reason: reason.slice(0, 500) })
          .eq("id", c.id).eq("review_state", "pending_review").select("id");
        if (data?.length) { await audit("campaign_review_rejected", "campaign", c.id, d.reason); rejected++; }
      } else rejected++;
    } else {
      console.log(`  •  keep    [${c.state || "FED"}] ${c.title.slice(0, 66)} — ${d.confidence}: ${d.reason.slice(0, 90)}`);
    }
  }

  // Intel
  const id_ = await pool(intel, 4, (a) => decide(a.title, a.locality));
  for (let i = 0; i < intel.length; i++) {
    const d = id_[i], a = intel[i];
    if (d.canApproveItem && approveBudget > 0) {
      console.log(`  ✅ APPROVE [${a.locality || "??"}] ${a.title.slice(0, 66)} — ${d.reason.slice(0, 100)}`);
      if (APPLY) {
        const { data } = await sb.from("policy_alerts")
          .update({ moderation_status: "approved", action_required: false, moderated_by: ACTOR, moderated_at: now(), moderation_note: `Auto-approved (clear-review-queues): ${d.reason}`.slice(0, 500) })
          .eq("id", a.id).eq("moderation_status", "pending").select("id");
        if (data?.length) { await audit("intel_tip_approved", "policy_alert", a.id, d.reason); approved++; approveBudget--; }
      } else { approved++; approveBudget--; }
    } else if (d.canReject) {
      console.log(`  ❌ REJECT  [${a.locality || "??"}] ${a.title.slice(0, 66)} — ${d.reason.slice(0, 100)}`);
      const reason = `Auto-rejected (clear-review-queues, ${now().slice(0, 10)}): ${d.reason}`;
      if (APPLY) {
        const { data } = await sb.from("policy_alerts")
          .update({ moderation_status: "rejected", moderated_by: ACTOR, moderated_at: now(), moderation_note: reason.slice(0, 500) })
          .eq("id", a.id).eq("moderation_status", "pending").select("id");
        if (data?.length) { await audit("intel_tip_rejected", "policy_alert", a.id, d.reason); rejected++; }
      } else rejected++;
    } else {
      console.log(`  •  keep    [${a.locality || "??"}] ${a.title.slice(0, 66)} — ${d.confidence}: ${d.reason.slice(0, 90)}`);
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${approved} approved, ${rejected} rejected. Uncertain items left for the next pass.`);
  return { rowsAdded: 0, rowsUpdated: APPLY ? approved + rejected : 0, notes: `${approved} approved, ${rejected} rejected${canApprove ? " (autonomy on)" : ""}` };
});
