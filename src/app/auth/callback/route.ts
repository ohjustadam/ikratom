import { NextRequest, NextResponse } from "next/server";
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

  // Validate the next path — only allow same-origin relative paths
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

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

  return NextResponse.redirect(new URL(safeNext, request.url));
}
