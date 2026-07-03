"use server";

/**
 * In-admin "Auto-resolve queue" server actions — the on-site equivalent of
 * scripts/clear-review-queues.mjs, so the whole capability lives in the admin
 * UI (no Claude / CLI dependency).
 *
 * Flow (owner decision 2026-07-03): PREVIEW then APPLY.
 *   analyze*  → read-only: dedup (supersede) + bill-terminal (reject) determin-
 *               istically, then a grounded free-tier AI fact-check (never Claude)
 *               for the rest → a proposed disposition per item.
 *   apply*    → mutation: applies the (possibly admin-edited) decisions, reusing
 *               the canonical review-transition + intel actions so an auto-resolve
 *               writes EXACTLY what a manual review writes. Approve is admin-only
 *               and fires the same user-notification trigger as a manual approve.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext, getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { applyCampaignReviewTransition } from "./campaign-review-shared";
import { approveIntelTip, rejectIntelTip } from "@/modules/alerts/actions";
import { clusterKey, isBillTerminal } from "@/lib/moderation/heuristics";
import { factCheckItem } from "@/lib/moderation/factcheck";
import type { AnalyzeResult, ApplyResult, Decision, PlanItem, ProposedAction } from "./queue-resolve-types";

// Cap grounded AI calls per analyze run (protects the daily Gemini grounding
// budget + keeps the request snappy). Dedup usually collapses far below this.
const AI_CAP = 15;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const band = (n: number): PlanItem["confidence"] => (n >= 0.75 ? "high" : n >= 0.45 ? "medium" : "low");
const billStatusOf = (bills: unknown): string | null => {
  const b = Array.isArray(bills) ? bills[0] : bills;
  return (b as { status?: string | null } | null)?.status ?? null;
};
const dispToAction = (d: "approve" | "reject" | "unsure"): ProposedAction =>
  d === "approve" ? "approve" : d === "reject" ? "reject" : "keep";

// ────────────────────────────── CAMPAIGNS ──────────────────────────────

export async function analyzeCampaignQueue(): Promise<AnalyzeResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!(await checkRateLimit(`queue-analyze:camp:${ctx.userId}`, 12, 3600)))
    return { ok: false, error: "Rate limit reached — try again in a bit." };

  const sb = await createClient();
  const { data } = await sb
    .from("campaigns")
    .select("id,title,state,bill_id,created_at,bills(status)")
    .eq("review_state", "pending_review")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  if (!rows.length) return { ok: true, items: [] };

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
    if (i >= AI_CAP) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.state || "FED"}`, action: "keep", reason: "Not auto-checked (fact-check cap reached) — review manually", confidence: "low", source: "cap" });
      continue;
    }
    const v = await factCheckItem("campaign", r.title, r.state);
    items.push({ id: r.id, title: r.title, subtitle: `${r.state || "FED"}`, action: dispToAction(v.disposition), reason: v.reason, confidence: band(v.confidence), source: "ai" });
  }
  return { ok: true, items };
}

export async function applyCampaignQueuePlan(decisions: Decision[]): Promise<ApplyResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { ok: false, error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { ok: false, error: mfaErr };

  const valid = (decisions ?? []).filter(
    (d) => typeof d?.id === "string" && UUID_RE.test(d.id) && ["approve", "reject", "supersede"].includes(d.action),
  );
  if (!valid.length) return { ok: false, error: "No changes to apply." };
  if (valid.length > 500) return { ok: false, error: "Too many at once (max 500)." };

  const approveIds = valid.filter((d) => d.action === "approve").map((d) => d.id);
  if (approveIds.length && !ctx.isAdmin && !ctx.isOwner)
    return { ok: false, error: "Only an admin can approve campaigns for publication." };

  const sb = await createClient();
  let approved = 0, rejected = 0, superseded = 0;

  if (approveIds.length) {
    const r = await applyCampaignReviewTransition(sb, { ids: approveIds, action: "approve", reviewerId: ctx.userId });
    if (!r.error) {
      approved = r.affected;
      for (const id of approveIds) await recordAdminAction({ action: "campaign_review_approved", targetType: "campaign", targetId: id, details: { via: "auto-resolve-panel" } });
    }
  }
  for (const d of valid.filter((d) => d.action === "reject")) {
    const r = await applyCampaignReviewTransition(sb, { ids: [d.id], action: "reject", reviewerId: ctx.userId, reason: (d.reason || "Auto-resolve").slice(0, 500) });
    if (!r.error && r.affected) { rejected++; await recordAdminAction({ action: "campaign_review_rejected", targetType: "campaign", targetId: d.id, details: { reason: d.reason, via: "auto-resolve-panel" } }); }
  }
  for (const d of valid.filter((d) => d.action === "supersede")) {
    const r = await applyCampaignReviewTransition(sb, { ids: [d.id], action: "supersede", reviewerId: ctx.userId, reason: (d.reason || "Duplicate").slice(0, 500) });
    if (!r.error && r.affected) { superseded++; await recordAdminAction({ action: "campaign_bulk_supersede", targetType: "campaign", targetId: d.id, details: { reason: d.reason, via: "auto-resolve-panel" } }); }
  }

  revalidatePath("/admin/campaigns/pending");
  return { ok: true, approved, rejected, superseded };
}

// ──────────────────────────────── INTEL ────────────────────────────────

export async function analyzeIntelQueue(): Promise<AnalyzeResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!(await checkRateLimit(`queue-analyze:intel:${ctx.userId}`, 12, 3600)))
    return { ok: false, error: "Rate limit reached — try again in a bit." };

  const sb = await createClient();
  const { data } = await sb
    .from("policy_alerts")
    .select("id,title,locality,kind,created_at")
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  if (!rows.length) return { ok: true, items: [] };

  const seen = new Map<string, string>();
  const items: PlanItem[] = [];
  const needAI: typeof rows = [];
  for (const r of rows) {
    const key = clusterKey(r.locality, r.title);
    if (seen.has(key)) {
      // policy_alerts has no 'superseded' state — a duplicate is a reject.
      items.push({ id: r.id, title: r.title, subtitle: `${r.locality} · duplicate`, action: "reject", reason: `Duplicate of "${seen.get(key)}" (same story)`, confidence: "high", source: "duplicate" });
      continue;
    }
    seen.set(key, r.title);
    needAI.push(r);
  }

  for (let i = 0; i < needAI.length; i++) {
    const r = needAI[i];
    if (i >= AI_CAP) {
      items.push({ id: r.id, title: r.title, subtitle: `${r.locality}`, action: "keep", reason: "Not auto-checked (fact-check cap reached) — review manually", confidence: "low", source: "cap" });
      continue;
    }
    const v = await factCheckItem("intel", r.title, r.locality);
    items.push({ id: r.id, title: r.title, subtitle: `${r.locality}`, action: dispToAction(v.disposition), reason: v.reason, confidence: band(v.confidence), source: "ai" });
  }
  return { ok: true, items };
}

export async function applyIntelQueuePlan(decisions: Decision[]): Promise<ApplyResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { ok: false, error: mfaErr };

  const valid = (decisions ?? []).filter(
    (d) => typeof d?.id === "string" && UUID_RE.test(d.id) && ["approve", "reject", "supersede"].includes(d.action),
  );
  if (!valid.length) return { ok: false, error: "No changes to apply." };
  if (valid.length > 500) return { ok: false, error: "Too many at once (max 500)." };

  let approved = 0, rejected = 0;
  for (const d of valid) {
    if (d.action === "approve") {
      // Publish as news only — action_required=false so no campaign auto-spawns.
      const r = await approveIntelTip({ alertId: d.id, actionRequired: false, note: (d.reason || "Auto-resolve: verified news").slice(0, 500) });
      if (!("error" in r)) approved++;
    } else {
      const r = await rejectIntelTip({ alertId: d.id, note: (d.reason || "Auto-resolve: not actionable").slice(0, 500) });
      if (!("error" in r)) rejected++;
    }
  }
  revalidatePath("/admin/intel-queue");
  return { ok: true, approved, rejected, superseded: 0 };
}
