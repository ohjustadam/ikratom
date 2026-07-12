"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { setMfaRecoveryPending } from "./mfa-bypass";

/**
 * Email-based 2FA recovery — the "I can't reach my authenticator AND I don't
 * have my backup codes" fallback (owner ask 2026-07-12).
 *
 * How it stays secure:
 *   - It requires an EXISTING aal1 session (the user is already past the
 *     password step, sitting at the /login/mfa challenge). So recovery needs
 *     BOTH the password (to be signed in) AND control of the email inbox —
 *     strictly stronger than the public, email-only password-reset flow.
 *   - Delivery reuses the ONLY confirmed-working Supabase send path in this
 *     project (the password-reset magic email → /auth/callback → PKCE
 *     exchangeCodeForSession). We send a magic sign-in link (signInWithOtp)
 *     whose redirect lands on /auth/mfa-recovered, which grants the same
 *     short-lived aal2 bypass cookie a backup code does — then notifies +
 *     audits so a silent takeover is impossible.
 *   - Rate-limited per user + per IP to prevent inbox flooding.
 *
 * Trade-off the owner accepted: whoever controls the email (plus the password)
 * can clear 2FA. The notification fired on /auth/mfa-recovered is the
 * detection backstop. SMS was declined (paid provider → breaks free-tier).
 */
export async function requestMfaEmailRecovery(): Promise<
  { ok: true } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Must already be signed in (aal1). This is the second factor (the first
  // being email control) — recovery is NOT an anonymous, email-only path.
  if (!user?.email) return { error: "Please sign in with your password first." };

  // Rate limit: 3 per user per hour + 5 per IP per hour (mirrors pwreset).
  const ip = await getClientIp();
  if (!(await checkRateLimit(`mfarecover:user:${user.id}`, 3, 3600))) {
    return { error: "Too many recovery requests. Try again in an hour." };
  }
  if (!(await checkRateLimit(`mfarecover:ip:${ip}`, 5, 3600))) {
    return { error: "Too many recovery requests. Try again in an hour." };
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3001";
  // Magic sign-in link → same working callback the password reset uses (PKCE,
  // same-device). next=/auth/mfa-recovered is where the aal2 bypass is granted.
  // shouldCreateUser:false — never mint an account from this path.
  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${appUrl}/auth/callback?next=/auth/mfa-recovered`,
    },
  });
  if (error) {
    console.error("[mfa-recovery]", error.message);
    // Generic success either way — the address is the user's own, so there's
    // no enumeration risk, but we still don't leak provider errors.
  }

  // Mark this browser as having initiated recovery. /auth/mfa-recovered will
  // ONLY grant the bypass if this marker is present — so a signed-in user can't
  // self-grant aal2 by navigating to that route directly.
  await setMfaRecoveryPending(user.id);
  return { ok: true };
}
