import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

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
  // The OTP shape. Supabase does not always come back with ?code=, and this
  // route used to treat every other shape as a hard failure — see failTo() below.
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

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

  /**
   * A failed PASSWORD RESET must not dead-end on /login.
   *
   * Every failure below used to redirect to /login?error=…, which is what the
   * owner reported on 2026-09-24: "the reset link simply takes the user back to
   * the login page". A login form does not tell someone their link expired, and
   * it does not offer them a new one — so the account stays locked and the
   * platform looks broken. A recovery attempt belongs back at /forgot, which
   * says so and can re-send.
   */
  const isRecovery = safeNext === "/reset-password" || type === "recovery";
  const failTo = (reason: string) =>
    NextResponse.redirect(
      new URL(
        isRecovery ? "/forgot?expired=1" : `/login?error=${encodeURIComponent(reason)}`,
        request.url,
      ),
    );

  if (error) return failTo(errorDescription ?? error);

  const supabase = await createClient();

  /**
   * TOKEN-HASH FALLBACK (2026-09-24). This route only ever accepted ?code=, the
   * PKCE shape, which needs the code_verifier cookie that was set in the SAME
   * browser that requested the reset. That assumption breaks in two ordinary
   * cases, and both land the user on /login:
   *
   *   - CROSS-DEVICE. Request the reset on a laptop, open the mail on a phone.
   *     No verifier cookie there, so exchangeCodeForSession always fails.
   *   - MAIL SCANNERS. Outlook and many corporate gateways pre-fetch links, and
   *     these tokens are single-use, so the human's click arrives already spent
   *     as ?error=access_denied&error_code=otp_expired.
   *
   * verifyOtp({ type, token_hash }) needs no verifier, so it survives both. We
   * cannot instead fix this in the email body: the dashboard requires custom
   * SMTP to edit templates and this project has none, so Supabase's default
   * template is what ships. src/app/auth/confirm/route.ts already proves this
   * exact pattern for admin-generated links.
   */
  if (!code) {
    if (!tokenHash || !type) return failTo("missing_code");
    const { error: otpErr } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (otpErr) return failTo(otpErr.message);
  } else {
    const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exchErr) return failTo(exchErr.message);
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

  return NextResponse.redirect(new URL(safeNext, request.url));
}
