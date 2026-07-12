import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildMfaRecoveryPendingCookie, verifyMfaRecoverReqToken } from "@/modules/auth/mfa-bypass";

/**
 * Auth callback for Supabase magic links — handles both:
 *  - Email confirmation (after signup)
 *  - Password reset (after /forgot)
 *  - Magic-link signin (future)
 *
 * The flow: user clicks link in email → lands here with ?code=...&next=...
 * We exchange the code for a session and redirect to `next`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Validate the next path — only allow same-origin relative paths. The old
  // check (startsWith("/") && !startsWith("//")) was bypassable: the WHATWG URL
  // parser strips control chars + folds backslashes, so `next=/\t//evil.com` or
  // `/\evil.com` resolved to an EXTERNAL origin (open redirect). Reject
  // protocol-relative, any backslash, and any whitespace/control char — matching
  // the stricter safeRelative() in src/modules/auth/actions.ts.
  const safeNext =
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !/[\s\0]/.test(next)
      ? next
      : "/dashboard";

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDescription ?? error)}`, request.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", request.url));
  }

  const supabase = await createClient();
  const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchErr) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(exchErr.message)}`, request.url),
    );
  }

  // First-time signup confirmation? Route through /onboarding instead of next.
  // Password resets explicitly use next=/reset-password so we honor that.
  if (safeNext === "/dashboard") {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("onboarded_at")
        .eq("id", user.id)
        .single();
      if (!prof?.onboarded_at) {
        return NextResponse.redirect(new URL("/onboarding", request.url));
      }
    }
  }

  // Password recovery: stamp an httpOnly marker proving this session arrived via
  // the emailed recovery link, bound to the user id. setNewPassword requires it
  // (pen-test #8) so a stolen NORMAL session can't silently reset the password
  // via /reset-password without the current one.
  if (safeNext === "/reset-password") {
    const { data: { user } } = await supabase.auth.getUser();
    const res = NextResponse.redirect(new URL(safeNext, request.url));
    if (user) {
      res.cookies.set("pw_recovery", user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 1800, // 30 min — ample to set the new password
      });
    }
    return res;
  }

  // Email 2FA-recovery: this exchange means the user just clicked the magic link
  // we emailed (proof of email control). Stamp the short-lived, user-bound
  // recovery-pending marker that /auth/mfa-recovered requires before it grants
  // the aal2 bypass. Mirrors the pw_recovery marker above — the marker is minted
  // by the email round-trip, never by the request button.
  if (safeNext === "/auth/mfa-recovered") {
    const { data: { user } } = await supabase.auth.getUser();
    const res = NextResponse.redirect(new URL(safeNext, request.url));
    // Only stamp the marker when the link carries a valid `mrt` token — which
    // ONLY the password-gated requestMfaEmailRecovery mints. A repurposed
    // public /forgot reset code (email-only, no valid mrt) therefore can't reach
    // aal2. If the token is missing/invalid, /auth/mfa-recovered will find no
    // marker and deny.
    if (user && verifyMfaRecoverReqToken(user.id, url.searchParams.get("mrt"))) {
      const m = buildMfaRecoveryPendingCookie(user.id);
      res.cookies.set(m.name, m.value, m.options);
    }
    return res;
  }

  return NextResponse.redirect(new URL(safeNext, request.url));
}
