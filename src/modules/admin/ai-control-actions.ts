"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "./actions";
import { whichAvailable } from "@/lib/ai/router";
import { getTodayQuotaStatus } from "@/lib/email/router";

/**
 * Read-side server actions for /admin/ai-control. All admin-only.
 * The dashboard renders server-side, so these are called during page
 * render — no extra round-trips for the initial paint.
 */

export type AiJobRow = {
  id: string;
  task_kind: string;
  provider_used: string | null;
  model_used: string | null;
  status: "pending" | "success" | "failure";
  prompt_preview: string | null;
  output_preview: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: string | null; // numeric → string from PG
  elapsed_ms: number | null;
  error: string | null;
  caller: string | null;
  created_at: string;
};

export type AiStatRow = {
  provider_used: string;
  task_kind: string;
  successes: number;
  failures: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: string;
  avg_elapsed_ms: number;
};

export async function listRecentAiJobs(limit = 100): Promise<{ rows: AiJobRow[] } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("ai_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) return { error: error.message };
  return { rows: (data ?? []) as AiJobRow[] };
}

export async function getAiStats24h(): Promise<{ rows: AiStatRow[] } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("ai_jobs_stats", { p_hours: 24 });
  if (error) return { error: error.message };
  return { rows: (data ?? []) as AiStatRow[] };
}

export async function getProviderAvailability() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const available = await whichAvailable();
  return { available };
}

export async function getEmailQuotaStatus() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const status = await getTodayQuotaStatus();
  return { status };
}
