import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { PENDING_JOIN_COOKIE, pendingJoinPath } from "@/lib/pending-join";
import { authLinkFailurePath } from "@/modules/auth/signup-outcome";

/**
 * Token-hash confirmation route. Every auth email lands here: the links we
 * build for admin.generateLink (field-signup invite, admin magic link and
 * reset), and since 2026-11-10 Supabase's own signup, reset and magic-link
 * emails too (templates in scripts/lib/auth-email-templates.mjs). It works in
 * any browser or mail app, because nothing depends on a cookie from the
 * browser that asked for the email.
 *
 * Why this exists separately from /auth/callback:
 *   /auth/callback uses exchangeCodeForSession(code), which is the PKCE
 *   flow. That only works for links a user's OWN browser initiated
 *   (signUp / signInWithOtp / resetPassword), because it needs the
 *   code_verifier cookie set at initiation. Admin-generated links have
 *   no such cookie, and Supabase (implicit flow) returns the session in
 *   the URL #fragment — which a server route can never read — so those
 *   links died on /auth/callback with ?error=missing_code.
 *
 *   verifyOtp({ type, token_hash }) exchanges the hashed token directly
 *   for a session via the SSR cookie adapter. No code_verifier, no
 *   fragment. This is the @supabase/ssr-recommended pattern for links we
 *   generate + send ourselves (via Resend).
 *
 * The email builds:  {APP_URL}/auth/confirm?token_hash=…&type=…&next=/account?welcome=1
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/dashboard";

  // Same strict same-origin relative-path guard as /auth/callback (open-redirect safe).
  const safeNext =
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !/[\s\0]/.test(next)
      ? next
      : "/dashboard";

  // A failed link lands on a page that explains it: /forgot for a password
  // reset, otherwise /login with a notice and a "send a new link" form. It used
  // to be /login?error=…, which the login form never reads.
  const isRecovery = safeNext === "/reset-password" || type === "recovery";
  const failTo = (reason: string) => {
    console.warn("[auth/confirm] link failed", { reason, type });
    return NextResponse.redirect(
      new URL(authLinkFailurePath({ isRecovery, hadCode: false }), request.url),
    );
  };

  if (!tokenHash || !type) return failTo("missing_token");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return failTo(error.code ?? error.message);

  // A group invite remembered at signup (src/lib/pending-join.ts): land in the
  // group, not the default page. Never on a password reset.
  if (safeNext !== "/reset-password") {
    const pending = pendingJoinPath(request.cookies.get(PENDING_JOIN_COOKIE)?.value);
    if (pending) {
      const res = NextResponse.redirect(new URL(pending, request.url));
      res.cookies.set(PENDING_JOIN_COOKIE, "", { maxAge: 0, path: "/" });
      return res;
    }
  }

  // First-time confirmation with no explicit destination → onboarding.
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

  // Password recovery: stamp the httpOnly pw_recovery marker (bound to user id)
  // that setNewPassword requires (pen-test #8) — parity with /auth/callback.
  // Without it the recovery session reaches /reset-password but can't actually
  // set a new password. Used by the admin "Send password reset" tool.
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
