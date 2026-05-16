"use server";

/**
 * Server action: record a user-reported error with auto-fix classification.
 *
 * Owner directive 2026-05-16: "the report error button to admin should
 * appear anytime a user gets an error."
 *
 * Reuses the same classifier (src/lib/auth-events-auto-fix.ts) so user-
 * side errors silently resolve and only escalated patterns reach admin.
 *
 * Anon-friendly — captures IP for abuse triage. Rate-limited at 10
 * reports per IP per hour to prevent flood.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClientIp, checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { attemptAutoFix } from "@/lib/auth-events-auto-fix";
import type { UserErrorKind } from "@/lib/user-error-reports";

export type ReportUserErrorInput = {
  kind: UserErrorKind;
  errorCode?: string | null;
  errorMessage?: string | null;
  userDescription?: string | null;
  context?: Record<string, unknown> | null;
};

export type ReportUserErrorResult =
  | { ok: true; reportId: string; escalated: boolean; autoResolvedHint: string | null }
  | { ok: false; error: string };

const MAX_DESC_LEN = 2000;
const MAX_MSG_LEN = 1000;

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function reportUserError(input: ReportUserErrorInput): Promise<ReportUserErrorResult> {
  const ip = await getClientIp();
  const allowed = await checkRateLimit(`userErrorReport:${ip}`, 10, 60 * 60);
  if (!allowed) {
    return { ok: false, error: "Too many error reports from this network. Wait a few minutes and try again." };
  }

  let h: Headers;
  try {
    h = await headers();
  } catch {
    h = new Headers();
  }
  const userAgent = h.get("user-agent")?.slice(0, 500) ?? null;

  let userId: string | null = null;
  let email: string | null = null;
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      userId = user.id;
      email = user.email ?? null;
    }
  } catch {
    // Pre-auth flows are expected to fail here
  }

  const db = admin();
  const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString();
  let recurrence = 0;
  if (input.errorCode) {
    const { count } = await db
      .from("user_error_reports")
      .select("id", { count: "exact", head: true })
      .eq("kind", input.kind)
      .eq("error_code", input.errorCode)
      .gte("created_at", sinceIso);
    recurrence = count ?? 0;
  }
  const verdict = attemptAutoFix({
    kind: input.kind,
    provider: null,
    errorCode: input.errorCode ?? null,
    recurrenceCount24h: recurrence,
  });

  const description = input.userDescription?.trim().slice(0, MAX_DESC_LEN) ?? null;
  const message = input.errorMessage?.slice(0, MAX_MSG_LEN) ?? null;
  const ctx = input.context ? JSON.parse(JSON.stringify(input.context).slice(0, 4000)) : null;

  const { data: inserted, error } = await db
    .from("user_error_reports")
    .insert({
      kind: input.kind,
      error_code: input.errorCode?.slice(0, 80) ?? null,
      error_message: message,
      context: ctx,
      user_id: userId,
      email,
      ip,
      user_agent: userAgent,
      user_description: description,
      auto_fix_attempted: true,
      auto_fix_outcome: verdict.outcome,
      auto_fix_notes: verdict.notes,
      escalated_to_admin: verdict.escalated,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[user-error-reports] insert failed:", error);
    return { ok: false, error: "Couldn't save the report. Please try again." };
  }

  const hint = verdict.escalated
    ? null
    : verdict.outcome === "resolved_user_side"
      ? "Looks like a user-side issue. Try again — admin already auto-resolved this kind."
      : verdict.outcome === "resolved_transient"
        ? "Likely a temporary network blip. Try again in a minute."
        : "Recorded — admin already auto-resolved this kind. Try again.";

  return {
    ok: true,
    reportId: inserted.id as string,
    escalated: verdict.escalated,
    autoResolvedHint: hint,
  };
}
