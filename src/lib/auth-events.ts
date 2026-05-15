/**
 * Helper for recording auth_events rows. Server-only.
 *
 * Migration 0144 — see SQL header for full schema.
 *
 * Write rules:
 *   - Best-effort: never throw, never block the caller. Failed event
 *     writes are console-logged + dropped.
 *   - Service-role client so we can write even when the user isn't
 *     authenticated yet (e.g. signup failure).
 *
 * Read rules: RLS restricts SELECT to admins. Read helpers below use
 * the service-role client to bypass RLS for admin pages.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { attemptAutoFix } from "./auth-events-auto-fix";

type AuthEventKind =
  | "signup" | "login" | "logout"
  | "oauth_start" | "oauth_callback"
  | "password_reset_request" | "password_reset_complete"
  | "mfa_challenge" | "mfa_verify"
  | "gmail_connect" | "discord_connect";

type AuthEventProvider =
  | "password" | "magic_link" | "totp"
  | "gmail" | "discord" | "google_signin";

type AuthEventStatus = "ok" | "fail" | "cancelled";

export type AuthEventInput = {
  kind: AuthEventKind;
  provider?: AuthEventProvider | null;
  status: AuthEventStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  context?: Record<string, unknown> | null;
};

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    const db = admin();

    // Run the auto-fix classifier FIRST so the row lands with its verdict
    // already attached. Only failure rows get classified — ok / cancelled
    // rows are recorded as-is.
    let autoFix: ReturnType<typeof attemptAutoFix> | null = null;
    if (input.status === "fail") {
      // Count recent recurrences of the same (kind, provider, error_code)
      // tuple so the classifier can promote a transient-looking error
      // to "escalate" when it's actually a sustained outage.
      let recurrence = 0;
      if (input.errorCode) {
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { count } = await db
          .from("auth_events")
          .select("id", { count: "exact", head: true })
          .eq("kind", input.kind)
          .eq("provider", input.provider ?? null)
          .eq("error_code", input.errorCode)
          .eq("status", "fail")
          .gte("created_at", since);
        recurrence = count ?? 0;
      }
      autoFix = attemptAutoFix({
        kind: input.kind,
        provider: input.provider ?? null,
        errorCode: input.errorCode ?? null,
        recurrenceCount24h: recurrence,
      });
    }

    await db.from("auth_events").insert({
      kind: input.kind,
      provider: input.provider ?? null,
      status: input.status,
      error_code: input.errorCode ? input.errorCode.slice(0, 80) : null,
      error_message: input.errorMessage ? input.errorMessage.slice(0, 500) : null,
      user_id: input.userId ?? null,
      email: input.email ? input.email.slice(0, 320) : null,
      ip: input.ip ? input.ip.slice(0, 64) : null,
      user_agent: input.userAgent ? input.userAgent.slice(0, 500) : null,
      context: input.context ?? null,
      auto_fix_attempted: autoFix !== null,
      auto_fix_outcome: autoFix?.outcome ?? null,
      auto_fix_notes: autoFix?.notes ?? null,
      escalated_to_admin: autoFix?.escalated ?? false,
    });
  } catch (e) {
    console.error("[auth-events] write failed:", e);
  }
}

export type AuthFailureCluster = {
  kind: string;
  provider: string | null;
  error_code: string | null;
  count: number;
  latest_at: string;
  /** Distinct from `count`: how many were auto-resolved before escalation.
   *  Surfaced on the admin panel as a "we already handled N" hint. */
  auto_resolved_count: number;
  /** Most recent auto_fix_notes line — explains the classifier's reasoning. */
  latest_notes: string | null;
  /** Filled if admin has already filed a GitHub issue for this cluster. */
  dev_issue_url: string | null;
};

/**
 * Aggregate recent failures by (kind, provider, error_code) for the
 * admin alert surface. Returns rows ordered by count DESC.
 *
 * By default, only ESCALATED failures appear — the auto-fix classifier
 * (migration 0146) handles user-side / transient errors invisibly.
 * Pass includeAutoResolved=true to see everything.
 *
 * Used by /admin/oauth-config to detect e.g. "5 redirect_uri_mismatch
 * errors in last 24h — Google Cloud Console config probably drifted."
 */
export async function recentAuthFailureSummary(opts: {
  sinceHours?: number;
  limit?: number;
  includeAutoResolved?: boolean;
} = {}): Promise<AuthFailureCluster[]> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24) * 3600_000).toISOString();
  let q = admin()
    .from("auth_events")
    .select("kind, provider, error_code, created_at, escalated_to_admin, auto_fix_attempted, auto_fix_outcome, auto_fix_notes, dev_issue_url")
    .eq("status", "fail")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (!opts.includeAutoResolved) {
    // Backward-compat: rows written before 0146 have auto_fix_attempted=false
    // AND escalated_to_admin=false. Treat those as "needs review" too so we
    // don't silently lose pre-migration history.
    q = q.or("escalated_to_admin.eq.true,auto_fix_attempted.eq.false");
  }
  const { data } = await q;

  const map = new Map<string, AuthFailureCluster & { auto_resolved_count: number }>();
  for (const row of (data ?? []) as Array<{
    kind: string;
    provider: string | null;
    error_code: string | null;
    created_at: string;
    escalated_to_admin: boolean | null;
    auto_fix_attempted: boolean | null;
    auto_fix_outcome: string | null;
    auto_fix_notes: string | null;
    dev_issue_url: string | null;
  }>) {
    const key = `${row.kind}|${row.provider ?? ""}|${row.error_code ?? ""}`;
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
        provider: row.provider,
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
 * Stats for the admin surface header — "auto-resolved N silently, escalated M".
 * Cheap rollup over the same window the failure summary uses.
 */
export async function authFailureAutoResolveStats(opts: { sinceHours?: number } = {}): Promise<{
  auto_resolved: number;
  escalated: number;
  unclassified_legacy: number;
}> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24) * 3600_000).toISOString();
  const { data } = await admin()
    .from("auth_events")
    .select("auto_fix_attempted, escalated_to_admin")
    .eq("status", "fail")
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

/**
 * Map an error_code to a one-line admin-friendly suggested fix.
 * Used to auto-suggest the right fix on /admin/oauth-config when
 * failures cluster around a known cause.
 */
export function suggestedFixForErrorCode(code: string): string | null {
  switch (code) {
    case "redirect_uri_mismatch":
      return "Google/Discord OAuth Console missing this site's redirect URI. Open /admin/oauth-config for the exact URI to add.";
    case "invalid_client":
      return "OAuth Client ID or Secret env var is wrong or revoked. Compare GOOGLE_OAUTH_CLIENT_ID / _SECRET against the developer console.";
    case "access_denied":
      return "User cancelled the OAuth consent screen. No admin action needed unless this is happening to many users.";
    case "no_refresh":
      return "Google didn't return a refresh_token. Usually means the user already granted consent and is being re-prompted. Set prompt=consent (already configured) or have the user revoke the app at myaccount.google.com/permissions and retry.";
    case "bad_state":
      return "CSRF token mismatch. Often a cookie issue: third-party-cookies blocked or cross-site cookie SameSite mismatch. Check that g_oauth_state cookie is being set + sent.";
    case "token_exchange":
    case "token_fetch":
      return "Network failure exchanging the auth code with Google. Transient; check Vercel runtime logs if it persists.";
    case "wrong_password":
    case "invalid_credentials":
      return "User-side error. No admin action needed unless attempts spike (possible brute-force).";
    case "Database error saving new user":
    case "db_signup":
      return "Signup trigger error. Check migration 0140's pgcrypto hotfix is still applied + extensions.gen_random_bytes resolves.";
    default:
      return null;
  }
}
