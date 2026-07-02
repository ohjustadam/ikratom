import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Token-hash confirmation route for SERVER-GENERATED auth links
 * (admin.generateLink) — e.g. the field-signup magic-link invite.
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

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
    );
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

  return NextResponse.redirect(new URL(safeNext, request.url));
}
