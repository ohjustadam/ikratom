"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext, getCreatorContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Owner-facing policy + ledger surface for the campaign auto-approve engine
 * (scripts/auto-approve-campaigns.mjs). The owner tunes RULES here, never
 * individual items. Reads are DEFENSIVE: if migrations 0182/0183 haven't been
 * applied yet, the policy columns / ledger table don't exist — we return safe
 * defaults + migrationApplied:false so the /admin/campaigns/pending page renders
 * normally (showing a "dormant" banner) instead of 500ing.
 */

export type CampaignAutoApprovePolicy = {
  mode: "off" | "shadow" | "live";
  minConfidence: number;
  requireSource: boolean;
  rejectEnabled: boolean;
  staleDays: number;
  maxPerRun: number;
  maxPerDay: number;
  minAgeHours: number;
  migrationApplied: boolean;
};

export type AutoDecisionRow = {
  id: string;
  campaign_id: string | null;
  decided_at: string;
  mode: string | null;
  decision: string;
  review_reason: string | null;
  applied: boolean;
  title: string | null;
};

const DEFAULTS: Omit<CampaignAutoApprovePolicy, "migrationApplied"> = {
  mode: "shadow",
  minConfidence: 0.85,
  requireSource: true,
  rejectEnabled: false,
  staleDays: 45,
  maxPerRun: 10,
  maxPerDay: 40,
  minAgeHours: 26,
};

export async function getCampaignAutoApprovePolicy(): Promise<CampaignAutoApprovePolicy> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("site_config")
    .select(
      "campaign_auto_approve_mode, campaign_auto_approve_min_confidence, campaign_auto_approve_require_source, " +
      "campaign_auto_reject_enabled, campaign_auto_approve_stale_days, campaign_auto_approve_max_per_run, " +
      "campaign_auto_approve_max_per_day, campaign_auto_approve_min_age_hours",
    )
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return { ...DEFAULTS, migrationApplied: false };
  const row = data as unknown as Record<string, unknown>;
  const mode = String(row.campaign_auto_approve_mode ?? "shadow");
  return {
    mode: (["off", "shadow", "live"].includes(mode) ? mode : "shadow") as CampaignAutoApprovePolicy["mode"],
    minConfidence: Number(row.campaign_auto_approve_min_confidence ?? 0.85),
    requireSource: (row.campaign_auto_approve_require_source ?? true) as boolean,
    rejectEnabled: (row.campaign_auto_reject_enabled ?? false) as boolean,
    staleDays: Number(row.campaign_auto_approve_stale_days ?? 45),
    maxPerRun: Number(row.campaign_auto_approve_max_per_run ?? 10),
    maxPerDay: Number(row.campaign_auto_approve_max_per_day ?? 40),
    minAgeHours: Number(row.campaign_auto_approve_min_age_hours ?? 26),
    migrationApplied: true,
  };
}

export async function setCampaignAutoApprovePolicy(input: {
  mode: string;
  minConfidence: number;
  requireSource: boolean;
  rejectEnabled: boolean;
  staleDays: number;
  maxPerRun: number;
  maxPerDay: number;
  minAgeHours: number;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const mode = (["off", "shadow", "live"].includes(input.mode) ? input.mode : "shadow") as
    "off" | "shadow" | "live";
  const rejectEnabled = !!input.rejectEnabled;

  // The two DANGEROUS knobs — going live (fires real legislator emails) and
  // enabling auto-reject (can bury a real CTA) — are OWNER-ONLY. Safer knobs
  // (source requirement, confidence, caps, maturity) remain admin-editable.
  if ((mode === "live" || rejectEnabled) && !ctx.isOwner) {
    return { error: "Only the owner can switch to live mode or enable auto-reject." };
  }

  const clampInt = (v: unknown, lo: number, hi: number, dflt: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number(v) || dflt)));
  const conf = Math.max(0.5, Math.min(1, Number(input.minConfidence) || 0.85));
  // mode='live' requires enabled=true (enforced by the 0182 DB CHECK).
  const enabled = mode === "live";

  const sb = await createClient();
  const { error } = await sb
    .from("site_config")
    .update({
      campaign_auto_approve_mode: mode,
      campaign_auto_approve_enabled: enabled,
      campaign_auto_approve_min_confidence: conf,
      campaign_auto_approve_require_source: !!input.requireSource,
      campaign_auto_reject_enabled: rejectEnabled,
      campaign_auto_approve_stale_days: clampInt(input.staleDays, 1, 365, 45),
      campaign_auto_approve_max_per_run: clampInt(input.maxPerRun, 1, 100, 10),
      campaign_auto_approve_max_per_day: clampInt(input.maxPerDay, 1, 500, 40),
      campaign_auto_approve_min_age_hours: clampInt(input.minAgeHours, 0, 168, 26),
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq("id", true);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "campaign_auto_approve_policy_updated",
    targetType: "user",
    targetId: ctx.userId,
    details: { mode, rejectEnabled, requireSource: !!input.requireSource, minConfidence: conf },
  });
  revalidatePath("/admin/campaigns/pending");
  return { ok: true };
}

/** Hard stop: drop the engine back to shadow (keeps logging, stops acting). Any
 *  admin can hit this — it's a safety control, not a dangerous one. */
export async function emergencyStopCampaignAutoApprove() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const sb = await createClient();
  const { error } = await sb
    .from("site_config")
    .update({
      campaign_auto_approve_mode: "shadow",
      campaign_auto_approve_enabled: false,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq("id", true);
  if (error) return { error: error.message };
  await recordAdminAction({
    action: "campaign_auto_approve_emergency_stop",
    targetType: "user",
    targetId: ctx.userId,
  });
  revalidatePath("/admin/campaigns/pending");
  return { ok: true };
}

/** The shadow/live decision ledger — the owner's evidence base for promotion. */
export async function listRecentAutoDecisions(limit = 30): Promise<AutoDecisionRow[]> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return [];
  const sb = await createClient();
  const { data, error } = await sb
    .from("campaign_auto_approve_decisions")
    .select("id, campaign_id, decided_at, mode, decision, review_reason, applied, campaigns(title)")
    .order("decided_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => {
    const c = r.campaigns as { title?: string } | { title?: string }[] | null;
    const title = Array.isArray(c) ? c[0]?.title ?? null : c?.title ?? null;
    return {
      id: String(r.id),
      campaign_id: (r.campaign_id as string | null) ?? null,
      decided_at: String(r.decided_at),
      mode: (r.mode as string | null) ?? null,
      decision: String(r.decision),
      review_reason: (r.review_reason as string | null) ?? null,
      applied: !!r.applied,
      title,
    };
  });
}

/** Re-pend campaigns the engine (or an admin) rejected — the undo for a wrong
 *  auto-reject, reachable from the show_rejected view. */
export async function reactivateRejectedCampaigns(ids: string[]) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const clean = (ids ?? []).filter((s) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500);
  if (clean.length === 0) return { error: "Nothing selected." };
  const sb = await createClient();
  const { data, error } = await sb
    .from("campaigns")
    .update({ review_state: "pending_review", reviewed_at: null, reviewed_by: null, review_reason: null })
    .in("id", clean)
    .eq("review_state", "rejected")
    .select("id");
  if (error) return { error: error.message };
  await recordAdminAction({
    action: "campaign_rejected_reactivated",
    targetType: "campaign",
    targetId: clean[0],
    details: { count: data?.length ?? 0 },
  });
  revalidatePath("/admin/campaigns/pending");
  return { ok: true, affected: data?.length ?? 0 };
}
