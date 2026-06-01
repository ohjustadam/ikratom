/**
 * Per-UTC-day budget guard for grounded Gemini queries.
 *
 * Counts today's `ai_jobs` rows where `task_kind = 'gemini_grounded'`
 * and refuses new calls once the configured cap is hit. Plus a small
 * helper to log a grounded call so the count + the AI Command Center
 * dashboard both see it.
 *
 * The cap lives on `site_config.gemini_grounded_daily_cap` (migration
 * 0169) so the owner can raise/lower it from /admin/ai-control without
 * a deploy.
 *
 * Logging via this helper also makes grounded calls visible on
 * /admin/ai-control. Before this, the four grounded code paths called
 * fetch() directly without going through src/lib/ai/jobs.ts → ai_jobs,
 * so the dashboard showed 0 activity for them.
 *
 * Mirror at scripts/lib/grounding-budget.mjs for .mjs scripts that
 * can't import from src/lib (no @/ alias resolution).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const TASK_KIND = "gemini_grounded";
const DEFAULT_CAP = 400;

export class GroundingQuotaError extends Error {
  readonly kind = "quota_exhausted" as const;
  constructor(public usedToday: number, public cap: number) {
    super(`Gemini grounded-query daily cap reached (${usedToday}/${cap}). Try again tomorrow (UTC).`);
    this.name = "GroundingQuotaError";
  }
}

export type GroundingBudgetStatus = {
  usedToday: number;
  cap: number;
  remaining: number;
  /** True when remaining <= 0 — every grounded caller should bail. */
  exhausted: boolean;
};

export async function getGroundingBudget(sb: SupabaseClient): Promise<GroundingBudgetStatus> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [{ count }, { data: cfg }] = await Promise.all([
    sb
      .from("ai_jobs")
      .select("id", { count: "exact", head: true })
      .eq("task_kind", TASK_KIND)
      .gte("created_at", startOfDay.toISOString()),
    sb
      .from("site_config")
      .select("gemini_grounded_daily_cap")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const usedToday = count ?? 0;
  const cap = (cfg?.gemini_grounded_daily_cap as number | null | undefined) ?? DEFAULT_CAP;
  return {
    usedToday,
    cap,
    remaining: Math.max(0, cap - usedToday),
    exhausted: usedToday >= cap,
  };
}

/**
 * Throws GroundingQuotaError when the daily cap is already hit. Call
 * this RIGHT BEFORE the fetch() to Gemini. Caller catches and decides
 * whether to surface to UI or skip the work item.
 */
export async function assertGroundingBudget(sb: SupabaseClient): Promise<GroundingBudgetStatus> {
  const status = await getGroundingBudget(sb);
  if (status.exhausted) throw new GroundingQuotaError(status.usedToday, status.cap);
  return status;
}

/**
 * Log one grounded call to ai_jobs. Always best-effort — logging
 * never blocks the caller's real return path. `outcome` distinguishes
 * the request actually made from the local-rep request being
 * idempotently skipped.
 */
export async function recordGroundingCall(
  sb: SupabaseClient,
  opts: {
    caller: string;
    status: "success" | "failure";
    elapsedMs?: number;
    error?: string;
    promptPreview?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await sb.from("ai_jobs").insert({
      task_kind: TASK_KIND,
      provider_used: "gemini",
      model_used: "gemini-2.5-flash-grounded",
      status: opts.status,
      prompt_preview: opts.promptPreview?.slice(0, 800) ?? null,
      elapsed_ms: opts.elapsedMs ?? null,
      error: opts.error?.slice(0, 800) ?? null,
      caller: opts.caller,
      metadata: opts.metadata ?? null,
      completed_at: new Date().toISOString(),
    });
  } catch {
    // logging never throws
  }
}
