import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { recordAuthEvent } from "@/lib/auth-events";

/**
 * Microsoft 365 / Outlook OAuth — send-on-behalf via Microsoft Graph.
 *
 * Mirrors the Gmail OAuth flow (src/app/api/oauth/google/start/route.ts)
 * but talks to Microsoft Identity Platform v2.0. Scopes are minimal:
 *
 *   - Mail.Send          — required to call /me/sendMail
 *   - offline_access     — required to get a refresh_token
 *   - User.Read          — only to fetch the connected mailbox address
 *
 * "common" tenant endpoint accepts personal Outlook.com accounts AND
 * work/school Microsoft 365 accounts.
 *
 * Required env vars (register the app at https://entra.microsoft.com):
 *   MICROSOFT_OAUTH_CLIENT_ID
 *   MICROSOFT_OAUTH_CLIENT_SECRET
 *
 * Required redirect URIs to register in the Azure app (same pattern as
 * Google — see AGENTS.md OAuth setup checklist):
 *   - https://www.ikratom.org/api/oauth/outlook/callback   (canonical prod)
 *   - https://ikratom.vercel.app/api/oauth/outlook/callback (Vercel preview)
 *   - http://localhost:3001/api/oauth/outlook/callback     (local dev)
 */
export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?redirect=/account", process.env.APP_URL!));
  }

  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  if (!clientId) {
    await recordAuthEvent({
      kind: "oauth_start", provider: "gmail", status: "fail",
      errorCode: "not_configured", userId: user.id, email: user.email, ip, userAgent,
      context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(
      new URL("/account?outlook_error=not_configured", process.env.APP_URL!),
    );
  }

  // CSRF state — separate cookie name from Google's `g_oauth_state` so
  // a user with both providers mid-flow doesn't collide.
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("ms_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  const redirectUri = `${process.env.APP_URL}/api/oauth/outlook/callback`;
  await recordAuthEvent({
    kind: "oauth_start", provider: "gmail", status: "ok",
    userId: user.id, email: user.email, ip, userAgent,
    context: { intended_provider: "outlook", redirect_uri: redirectUri },
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // The narrowest possible Microsoft mail scope is `Mail.Send` — it
    // lets us send mail on behalf of the user but NOT read their inbox.
    // offline_access is required to receive a refresh_token.
    // User.Read is needed only to fetch the connected mailbox email.
    scope: "Mail.Send offline_access User.Read",
    state,
    response_mode: "query",
    // Force consent so we always get a refresh_token, even if the user
    // has connected before (matches the prompt=consent behavior used
    // in the Google flow).
    prompt: "consent",
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
  );
}
