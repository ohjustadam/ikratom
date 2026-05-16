/**
 * User-error reporting read helpers + types.
 *
 * Owner directive 2026-05-16: "we need the same self healing capabilities
 * for the user log in as well. the report error button to admin should
 * appear anytime a user gets an error."
 *
 * Server-side reads only — no client surface. The server action that
 * writes lives in `src/modules/admin/user-error-actions.ts` (so it can
 * use `"use server"` cleanly without mixing in type exports).
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export type UserErrorKind =
  | "login"
  | "signup"
  | "submission"
  | "navigation"
  | "research_submit"
  | "forum_post"
  | "campaign_send"
  | "story_submit"
  | "intel_tip_submit"
  | "other";

export type UserErrorCluster = {
  kind: string;
  error_code: string | null;
  count: number;
  latest_at: string;
  auto_resolved_count: number;
  latest_notes: string | null;
  dev_issue_url: string | null;
};

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Aggregate escalated user-error reports for the admin panel.
 * Auto-resolved reports never appear here (they're handled silently).
 */
export async function recentUserErrorSummary(opts: {
  sinceHours?: number;
  limit?: number;
} = {}): Promise<UserErrorCluster[]> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24 * 7) * 3600_000).toISOString();
  const { data } = await admin()
    .from("user_error_reports")
    .select("kind, error_code, created_at, escalated_to_admin, auto_fix_attempted, auto_fix_outcome, auto_fix_notes, dev_issue_url")
    .gte("created_at", since)
    .or("escalated_to_admin.eq.true,auto_fix_attempted.eq.false")
    .order("created_at", { ascending: false })
    .limit(2000);

  const map = new Map<string, UserErrorCluster & { auto_resolved_count: number }>();
  for (const row of (data ?? []) as Array<{
    kind: string;
    error_code: string | null;
    created_at: string;
    escalated_to_admin: boolean | null;
    auto_fix_attempted: boolean | null;
    auto_fix_outcome: string | null;
    auto_fix_notes: string | null;
    dev_issue_url: string | null;
  }>) {
    const key = `${row.kind}|${row.error_code ?? ""}`;
    const existing = map.get(key);
    const wasAutoResolved = row.auto_fix_attempted === true && row.escalated_to_admin === false;
    if (existing) {
      existing.count++;
      if (wasAutoResolved) existing.auto_resolved_count++;
      if (row.created_at > existing.latest_at) {
        existing.latest_at = row.created_at;
        if (row.auto_fix_notes) existing.latest_notes = row.auto_fix_notes;
      }
      if (!existing.dev_issue_url && row.dev_issue_url) existing.dev_issue_url = row.dev_issue_url;
    } else {
      map.set(key, {
        kind: row.kind,
        error_code: row.error_code,
        count: 1,
        latest_at: row.created_at,
        auto_resolved_count: wasAutoResolved ? 1 : 0,
        latest_notes: row.auto_fix_notes ?? null,
        dev_issue_url: row.dev_issue_url ?? null,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, opts.limit ?? 50);
}

/**
 * Stats rollup for the admin surface header — "auto-resolved N silently,
 * escalated M". Mirrors authFailureAutoResolveStats().
 */
export async function userErrorAutoResolveStats(opts: { sinceHours?: number } = {}): Promise<{
  auto_resolved: number;
  escalated: number;
  unclassified_legacy: number;
}> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24 * 7) * 3600_000).toISOString();
  const { data } = await admin()
    .from("user_error_reports")
    .select("auto_fix_attempted, escalated_to_admin")
    .gte("created_at", since)
    .limit(5000);
  let auto_resolved = 0, escalated = 0, unclassified_legacy = 0;
  for (const row of (data ?? []) as Array<{ auto_fix_attempted: boolean | null; escalated_to_admin: boolean | null }>) {
    if (row.auto_fix_attempted === true && row.escalated_to_admin === false) auto_resolved++;
    else if (row.escalated_to_admin === true) escalated++;
    else unclassified_legacy++;
  }
  return { auto_resolved, escalated, unclassified_legacy };
}
