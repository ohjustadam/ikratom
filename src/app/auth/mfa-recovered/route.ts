import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  buildMfaBypassCookie,
  consumeMfaRecoveryPending,
  expiredMfaRecoveryPendingCookie,
} from "@/modules/auth/mfa-bypass";
import { recordAdminAction } from "@/lib/audit";

/**
 * Landing route for the email 2FA-recovery magic link.
 *
 * The flow: /login/mfa → requestMfaEmailRecovery() sends a magic sign-in link
 * (via Supabase, same channel as password reset) whose redirect is
 * /auth/callback?next=/auth/mfa-recovered. /auth/callback exchanges the code
 * for a fresh session, then redirects here.
 *
 * We grant the SAME short-lived aal2 bypass a backup code grants — BUT only if
 * a valid recovery-pending marker is present for this user. That marker was set
 * when they clicked "email me a recovery link" (an aal1-gated action), so a
 * signed-in user cannot self-grant aal2 by navigating here directly. Every
 * successful grant fires a security notification + audit entry so a recovery
 * the user didn't initiate is immediately visible.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The magic-link exchange should have established a session on /auth/callback.
  if (!user) {
    return NextResponse.redirect(
      new URL("/login?error=recovery_link_expired", request.url),
    );
  }

  // Gate: the session must have arrived via a real recovery request.
  const allowed = await consumeMfaRecoveryPending(user.id);
  if (!allowed) {
    // Direct navigation / stale link — do NOT grant a bypass.
    return NextResponse.redirect(
      new URL("/account/security?recovery=expired", request.url),
    );
  }

  const res = NextResponse.redirect(
    new URL("/account/security?recovered=1", request.url),
  );
  // Grant the 1-hour aal2 bypass (same mechanism as a backup code) + clear the
  // one-time pending marker — both on THIS response (reliable in a route handler).
  const bypass = buildMfaBypassCookie(user.id);
  res.cookies.set(bypass.name, bypass.value, bypass.options);
  const cleared = expiredMfaRecoveryPendingCookie();
  res.cookies.set(cleared.name, cleared.value, cleared.options);

  // Security notification (service role — notifications RLS blocks self-insert)
  // + best-effort audit. Never block the redirect on these.
  try {
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    await admin.from("notifications").insert({
      user_id: user.id,
      kind: "security",
      title: "Your 2FA was recovered via email",
      body:
        "Someone with your password and email access just regained elevated access to your account by email recovery (valid ~1 hour). If this wasn't you, change your password now and review your sessions.",
      link: "/account/security",
    });
  } catch (e) {
    console.error("[mfa-recovered] notification failed:", e);
  }
  try {
    await recordAdminAction({
      action: "mfa_email_recovery_used",
      targetType: "user",
      targetId: user.id,
    });
  } catch {
    // audit is best-effort; the notification is the load-bearing alert
  }

  return res;
}
