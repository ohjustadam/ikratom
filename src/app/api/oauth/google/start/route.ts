import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { recordAuthEvent } from "@/lib/auth-events";

/**
 * Initiates the Google OAuth flow for Gmail send-on-behalf.
 * Generates a CSRF state token (stored in HttpOnly cookie),
 * then redirects the user to Google's consent screen.
 */
export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?redirect=/account", process.env.APP_URL!));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    await recordAuthEvent({
      kind: "oauth_start", provider: "gmail", status: "fail",
      errorCode: "not_configured", userId: user.id, email: user.email, ip, userAgent,
    });
    return NextResponse.redirect(
      new URL("/account?gmail_error=not_configured", process.env.APP_URL!)
    );
  }

  // CSRF state token — random, opaque, single-use
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("g_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 min
    path: "/",
  });

  const redirectUri = `${process.env.APP_URL}/api/oauth/google/callback`;
  await recordAuthEvent({
    kind: "oauth_start", provider: "gmail", status: "ok",
    userId: user.id, email: user.email, ip, userAgent,
    context: { redirect_uri: redirectUri },
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // gmail.send is the minimum scope needed to send mail. We don't request
    // read scopes — keeps user's privacy intact and avoids the verification
    // process for sensitive scopes.
    scope: "https://www.googleapis.com/auth/gmail.send",
    access_type: "offline",  // refresh_token
    prompt: "consent",       // force re-consent so we always get a refresh_token
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
