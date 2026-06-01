"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "./actions";
import { whichAvailable } from "@/lib/ai/router";
import { getTodayQuotaStatus } from "@/lib/email/router";
import { getGroundingBudget, type GroundingBudgetStatus } from "@/lib/ai/grounding-budget";

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

/**
 * Today's grounded-Gemini query count + the configured daily cap.
 * Backs the "Gemini grounding quota" panel on /admin/ai-control.
 * See migration 0169 + src/lib/ai/grounding-budget.ts.
 */
export async function getGroundingQuotaStatus(): Promise<
  { status: GroundingBudgetStatus } | { error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = createServiceRoleClient();
  const status = await getGroundingBudget(supabase);
  return { status };
}

/**
 * Runtime env-var presence diagnostic. Returns BOOLEANS only — never
 * the actual values. Lets an admin confirm at a glance whether a
 * given key made it from Vercel into the running deploy, which is the
 * #1 cause of "I added the env var but the provider still shows
 * down" confusion. (Vercel "Redeploy" reuses the build cache and can
 * pin stale env vars; a fresh build is needed to pick up additions.)
 *
 * Grouped by feature area so the panel can render with context. Add
 * new vars to the appropriate group as they're introduced.
 */
export type EnvPresenceGroup = {
  group: string;
  vars: Array<{ key: string; present: boolean; required: boolean; note?: string }>;
};

export async function getEnvPresence(): Promise<
  { groups: EnvPresenceGroup[] } | { error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const has = (k: string) => !!process.env[k] && process.env[k]!.length > 0;
  const groups: EnvPresenceGroup[] = [
    {
      group: "Core",
      vars: [
        { key: "NEXT_PUBLIC_SUPABASE_URL", present: has("NEXT_PUBLIC_SUPABASE_URL"), required: true },
        { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", present: has("NEXT_PUBLIC_SUPABASE_ANON_KEY"), required: true },
        { key: "SUPABASE_SERVICE_ROLE_KEY", present: has("SUPABASE_SERVICE_ROLE_KEY"), required: true },
        { key: "APP_URL", present: has("APP_URL"), required: true },
        { key: "CRON_SECRET", present: has("CRON_SECRET"), required: true, note: "protects /api/cron/*" },
      ],
    },
    {
      group: "AI providers",
      vars: [
        { key: "GROQ_API_KEY", present: has("GROQ_API_KEY"), required: false, note: "speed fallback" },
        { key: "GEMINI_API_KEY", present: has("GEMINI_API_KEY"), required: false, note: "grounded research" },
        { key: "CEREBRAS_API_KEY", present: has("CEREBRAS_API_KEY"), required: false, note: "3rd cloud rotation" },
        { key: "OLLAMA_HOST", present: has("OLLAMA_HOST"), required: false, note: "defaults to localhost" },
        { key: "ANTHROPIC_API_KEY", present: has("ANTHROPIC_API_KEY"), required: false, note: "future paid features" },
      ],
    },
    {
      group: "Email",
      vars: [
        { key: "RESEND_API_KEY", present: has("RESEND_API_KEY"), required: false, note: "100/day free" },
        { key: "RESEND_FROM_EMAIL", present: has("RESEND_FROM_EMAIL"), required: false },
        { key: "BREVO_API_KEY", present: has("BREVO_API_KEY"), required: false, note: "300/day free" },
        { key: "MAILJET_API_KEY", present: has("MAILJET_API_KEY"), required: false, note: "200/day free" },
        { key: "MAILERSEND_API_KEY", present: has("MAILERSEND_API_KEY"), required: false, note: "100/day free" },
      ],
    },
    {
      group: "Legislative data",
      vars: [
        { key: "LEGISCAN_API_KEY", present: has("LEGISCAN_API_KEY"), required: false, note: "30k queries/mo free" },
        { key: "OPENSTATES_API_KEY", present: has("OPENSTATES_API_KEY"), required: false },
      ],
    },
    {
      group: "OAuth integrations",
      vars: [
        { key: "GOOGLE_OAUTH_CLIENT_ID", present: has("GOOGLE_OAUTH_CLIENT_ID"), required: false, note: "Gmail send" },
        { key: "GOOGLE_OAUTH_CLIENT_SECRET", present: has("GOOGLE_OAUTH_CLIENT_SECRET"), required: false },
        { key: "DISCORD_OAUTH_CLIENT_ID", present: has("DISCORD_OAUTH_CLIENT_ID"), required: false, note: "account linking" },
        { key: "DISCORD_OAUTH_CLIENT_SECRET", present: has("DISCORD_OAUTH_CLIENT_SECRET"), required: false },
      ],
    },
    {
      group: "Push notifications",
      vars: [
        { key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", present: has("NEXT_PUBLIC_VAPID_PUBLIC_KEY"), required: false },
        { key: "VAPID_PRIVATE_KEY", present: has("VAPID_PRIVATE_KEY"), required: false },
        { key: "VAPID_SUBJECT", present: has("VAPID_SUBJECT"), required: false },
      ],
    },
  ];

  return { groups };
}
