"use server";

/**
 * In-admin queue resolution — the on-site equivalent of the CLI/cron cleaners,
 * so the whole capability lives in the admin UI (no Claude / CLI dependency).
 *
 * Two modes share ONE analysis + apply core:
 *   - PREVIEW  (analyze* → applyPlan*): propose per-item, admin edits, then apply.
 *   - FULL-AUTO (autoResolveQueue): analyze + immediately apply every confident
 *     decision in one click. Approve only on a confident grounded verdict (it
 *     fires user notifications); dedup → supersede; junk → reject; genuinely
 *     unverifiable → reject (reversible + logged) so the queue still ends empty.
 *     Unchecked overflow (past the fact-check cap) is LEFT in queue, never blind-
 *     rejected — the cron drains it next pass.
 *
 * Everything reuses the canonical review-transition + intel actions so an auto
 * resolve writes EXACTLY what a manual review writes. Admin-gated + MFA + audit.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminContext, getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { applyCampaignReviewTransition } from "./campaign-review-shared";
import { approveIntelTip, rejectIntelTip } from "@/modules/alerts/actions";
import { clusterKey, isBillTerminal } from "@/lib/moderation/heuristics";
import { factCheckItem } from "@/lib/moderation/factcheck";
import type {
  AnalyzeResult, ApplyResult, Decision, PlanItem, ProposedAction, QueueKind,
} from "./queue-resolve-types";

const PREVIEW_AI_CAP = 15; // interactive: keep the panel snappy
const AUTO_AI_CAP = 40; // full-auto: check more before leaving overflow for the cron
const UUID_RE = /^[0-9a-f-]{36}$/i;
const band = (n: number): PlanItem["confidence"] => (n >= 0.75 ? "high" : n >= 0.45 ? "medium" : "low");
const billStatusOf = (bills: unknown): string | null => {
  const b = Array.isArray(bills) ? bills[0] : bills;
  return (b as { status?: string | null } | null)?.status ?? null;
};
const dispToAction = (d: "approve" | "reject" | "unsure"): ProposedAction =>
  d === "approve" ? "approve" : d === "reject" ? "reject" : "keep";

// ── Plan builders (no auth; callers gate) ──────────────────────────────────

async function buildCampaignPlan(sb: SupabaseClient, aiCap: number): Promise<PlanItem[]> {
  const { data } = await sb
    .from("campaigns")
    .select("id,title,state,bill_id,created_at,bills(status)")
    .eq("review_state", "pending_review")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const seen = new Map<string, string>();
  const items: PlanItem[] = [];
  const needAI: typeof rows = [];
  for (const r of rows) {
    const key = clusterKey(r.state, r.title);
    if (seen.has(key)) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.state || "FED"} · duplicate`, action: "supersede", reason: `Duplicate of "${seen.get(key)}" (same event/state)`, confidence: "high", source: "duplicate" });
      continue;
    }
    seen.set(key, r.title);
    const status = billStatusOf(r.bills);
    if (r.bill_id && isBillTerminal(status)) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.state || "FED"} · bill ${status}`, action: "reject", reason: `Linked bill is ${status} — constituent action no longer applies`, confidence: "high", source: "bill-status" });
      continue;
    }
    needAI.push(r);
  }
  for (let i = 0; i < needAI.length; i++) {
    const r = needAI[i];
    if (i >= aiCap) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.state || "FED"}`, action: "keep", reason: "Not auto-checked (fact-check cap) — left for the next pass", confidence: "low", source: "cap" });
      continue;
    }
    const v = await factCheckItem("campaign", r.title, r.state);
    items.push({ id: r.id, title: r.title, subtitle: `${r.state || "FED"}`, action: dispToAction(v.disposition), reason: v.reason, confidence: band(v.confidence), source: "ai" });
  }
  return items;
}

async function buildIntelPlan(sb: SupabaseClient, aiCap: number): Promise<PlanItem[]> {
  const { data } = await sb
    .from("policy_alerts")
    .select("id,title,locality,kind,created_at")
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const seen = new Map<string, string>();
  const items: PlanItem[] = [];
  const needAI: typeof rows = [];
  for (const r of rows) {
    const key = clusterKey(r.locality, r.title);
    if (seen.has(key)) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.locality} · duplicate`, action: "reject", reason: `Duplicate of "${seen.get(key)}" (same story)`, confidence: "high", source: "duplicate" });
      continue;
    }
    seen.set(key, r.title);
    needAI.push(r);
  }
  for (let i = 0; i < needAI.length; i++) {
    const r = needAI[i];
    if (i >= aiCap) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.locality}`, action: "keep", reason: "Not auto-checked (fact-check cap) — left for the next pass", confidence: "low", source: "cap" });
      continue;
    }
    const v = await factCheckItem("intel", r.title, r.locality);
    items.push({ id: r.id, title: r.title, subtitle: `${r.locality}`, action: dispToAction(v.disposition), reason: v.reason, confidence: band(v.confidence), source: "ai" });
  }
  return items;
}

// ── Decision appliers (caller already auth+MFA'd) ──────────────────────────

function sanitize(decisions: Decision[]): Decision[] {
  return (decisions ?? []).filter(
    (d) => typeof d?.id === "string" && UUID_RE.test(d.id) && ["approve", "reject", "supersede"].includes(d.action),
  ).slice(0, 500);
}

async function applyCampaignDecisions(sb: SupabaseClient, reviewerId: string, ds: Decision[]) {
  let approved = 0, rejected = 0, superseded = 0;
  const approveIds = ds.filter((d) => d.action === "approve").map((d) => d.id);
  if (approveIds.length) {
    // suppressNotify: a bulk/auto resolve must NOT fire a notification per
    // approved campaign (that's the spam). Deliberate single approves still notify.
    const r = await applyCampaignReviewTransition(sb, { ids: approveIds, action: "approve", reviewerId, suppressNotify: true });
    if (!r.error) { approved = r.affected; for (const id of approveIds) await recordAdminAction({ action: "campaign_review_approved", targetType: "campaign", targetId: id, details: { via: "auto-resolve", notify: false } }); }
  }
  for (const d of ds.filter((d) => d.action === "reject")) {
    const r = await applyCampaignReviewTransition(sb, { ids: [d.id], action: "reject", reviewerId, reason: (d.reason || "Auto-resolve").slice(0, 500) });
    if (!r.error && r.affected) { rejected++; await recordAdminAction({ action: "campaign_review_rejected", targetType: "campaign", targetId: d.id, details: { reason: d.reason, via: "auto-resolve" } }); }
  }
  for (const d of ds.filter((d) => d.action === "supersede")) {
    const r = await applyCampaignReviewTransition(sb, { ids: [d.id], action: "supersede", reviewerId, reason: (d.reason || "Duplicate").slice(0, 500) });
    if (!r.error && r.affected) { superseded++; await recordAdminAction({ action: "campaign_bulk_supersede", targetType: "campaign", targetId: d.id, details: { reason: d.reason, via: "auto-resolve" } }); }
  }
  return { approved, rejected, superseded };
}

async function applyIntelDecisions(ds: Decision[]) {
  let approved = 0, rejected = 0;
  for (const d of ds) {
    if (d.action === "approve") {
      // suppressPush: publish to /pulse but don't let push-critical-alerts blast
      // it — a bulk resolve shouldn't spam. Deliberate single approves still push.
      const r = await approveIntelTip({ alertId: d.id, actionRequired: false, suppressPush: true, note: (d.reason || "Auto-resolve: verified news").slice(0, 500) });
      if (!("error" in r)) approved++;
    } else {
      const r = await rejectIntelTip({ alertId: d.id, note: (d.reason || "Auto-resolve: not actionable").slice(0, 500) });
      if (!("error" in r)) rejected++;
    }
  }
  return { approved, rejected, superseded: 0 };
}

/**
 * Full-auto policy: turn a proposal into a final action.
 * - dedup/junk rejects + supersedes apply as-is.
 * - approve applies ONLY on a confident grounded verdict (fires notifications);
 *   a low-confidence "approve" downgrades to reject (safe).
 * - AI "unsure" → reject (empties queue, reversible).
 * - overflow past the fact-check cap ("keep"/source=cap) is left in queue.
 */
function autoDecision(p: PlanItem): ProposedAction {
  if (p.action === "supersede" || p.action === "reject") return p.action;
  if (p.action === "approve") return p.confidence === "low" ? "reject" : "approve";
  return p.source === "cap" ? "keep" : "reject"; // keep = leave untouched
}

// ── Public server actions ──────────────────────────────────────────────────

export async function analyzeCampaignQueue(): Promise<AnalyzeResult> {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!(await checkRateLimit(`queue-analyze:camp:${ctx.userId}`, 12, 3600))) return { ok: false, error: "Rate limit reached — try again in a bit." };
  const sb = await createClient();
  return { ok: true, items: await buildCampaignPlan(sb, PREVIEW_AI_CAP) };
}

export async function analyzeIntelQueue(): Promise<AnalyzeResult> {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!(await checkRateLimit(`queue-analyze:intel:${ctx.userId}`, 12, 3600))) return { ok: false, error: "Rate limit reached — try again in a bit." };
  const sb = await createClient();
  return { ok: true, items: await buildIntelPlan(sb, PREVIEW_AI_CAP) };
}

export async function applyCampaignQueuePlan(decisions: Decision[]): Promise<ApplyResult> {
  const ctx = await getCreatorContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) return { ok: false, error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx); if (mfaErr) return { ok: false, error: mfaErr };
  const ds = sanitize(decisions);
  if (!ds.length) return { ok: false, error: "No changes to apply." };
  if (ds.some((d) => d.action === "approve") && !ctx.isAdmin && !ctx.isOwner) return { ok: false, error: "Only an admin can approve campaigns for publication." };
  const sb = await createClient();
  const r = await applyCampaignDecisions(sb, ctx.userId, ds);
  revalidatePath("/admin/campaigns/pending"); revalidatePath("/admin/moderation");
  return { ok: true, ...r };
}

export async function applyIntelQueuePlan(decisions: Decision[]): Promise<ApplyResult> {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  const mfaErr = requireMfaForMutation(ctx); if (mfaErr) return { ok: false, error: mfaErr };
  const ds = sanitize(decisions);
  if (!ds.length) return { ok: false, error: "No changes to apply." };
  const r = await applyIntelDecisions(ds);
  revalidatePath("/admin/intel-queue"); revalidatePath("/admin/moderation");
  return { ok: true, ...r };
}

/** One-click FULL AUTO: analyze + apply every confident decision. */
export async function autoResolveQueue(kind: QueueKind): Promise<ApplyResult> {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" }); // full-auto approves → admin required
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  const mfaErr = requireMfaForMutation(ctx); if (mfaErr) return { ok: false, error: mfaErr };
  if (!(await checkRateLimit(`queue-auto:${kind}:${ctx.userId}`, 6, 3600))) return { ok: false, error: "Rate limit reached — try again in a bit." };
  const sb = await createClient();
  const plan = kind === "campaigns" ? await buildCampaignPlan(sb, AUTO_AI_CAP) : await buildIntelPlan(sb, AUTO_AI_CAP);
  const decisions: Decision[] = plan
    .map((p) => ({ item: p, action: autoDecision(p) }))
    .filter((x) => x.action !== "keep")
    .map((x) => ({ id: x.item.id, action: x.action, reason: x.item.reason }));
  if (!decisions.length) return { ok: true, approved: 0, rejected: 0, superseded: 0 };
  const r = kind === "campaigns"
    ? await applyCampaignDecisions(sb, ctx.userId, decisions)
    : await applyIntelDecisions(decisions);
  await recordAdminAction({ action: "queue_auto_resolved", targetType: kind === "campaigns" ? "campaign" : "policy_alert", details: { kind, ...r, via: "auto-resolve-oneclick" } });
  revalidatePath(kind === "campaigns" ? "/admin/campaigns/pending" : "/admin/intel-queue");
  revalidatePath("/admin/moderation");
  return { ok: true, ...r };
}

/** Pending counts for the unified moderation panel. */
export async function queueCounts(): Promise<{ campaigns: number; intel: number }> {
  const ctx = await getAdminContext({ require: "moderate_intel_queue" });
  if (!ctx.ok) return { campaigns: 0, intel: 0 };
  const sb = await createClient();
  const [c, i] = await Promise.all([
    sb.from("campaigns").select("id", { count: "exact", head: true }).eq("review_state", "pending_review"),
    sb.from("policy_alerts").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
  ]);
  return { campaigns: c.count ?? 0, intel: i.count ?? 0 };
}
