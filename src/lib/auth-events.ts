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
    await admin().from("auth_events").insert({
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
    });
  } catch (e) {
    console.error("[auth-events] write failed:", e);
  }
}

/**
 * Aggregate recent failures by (kind, provider, error_code) for the
 * admin alert surface. Returns rows ordered by count DESC.
 *
 * Used by /admin/oauth-config to detect e.g. "5 redirect_uri_mismatch
 * errors in last 24h — Google Cloud Console config probably drifted."
 */
export async function recentAuthFailureSummary(opts: {
  sinceHours?: number;
  limit?: number;
} = {}): Promise<Array<{
  kind: string;
  provider: string | null;
  error_code: string | null;
  count: number;
  latest_at: string;
}>> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24) * 3600_000).toISOString();
  const { data } = await admin()
    .from("auth_events")
    .select("kind, provider, error_code, created_at")
    .eq("status", "fail")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const map = new Map<string, { kind: string; provider: string | null; error_code: string | null; count: number; latest_at: string }>();
  for (const row of (data ?? []) as Array<{ kind: string; provider: string | null; error_code: string | null; created_at: string }>) {
    const key = `${row.kind}|${row.provider ?? ""}|${row.error_code ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (row.created_at > existing.latest_at) existing.latest_at = row.created_at;
    } else {
      map.set(key, { kind: row.kind, provider: row.provider, error_code: row.error_code, count: 1, latest_at: row.created_at });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, opts.limit ?? 50);
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
