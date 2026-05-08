import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Initiates the Discord OAuth flow.
 *
 * Two modes:
 *   1. Linked-account mode: user is already signed in to iKratom and
 *      wants to attach their Discord identity to their profile.
 *   2. Sign-in mode: user is anonymous and wants to authenticate via
 *      Discord. Currently we treat this as "must already have an
 *      iKratom account" and redirect anon users to /signup with a
 *      flash — full Discord-only signup is a v2 feature.
 *
 * CSRF: random state token in HttpOnly cookie, verified on callback.
 *
 * Scopes: identify (returns user id, username, avatar) + email (so we
 * can preview-match an existing account by email).
 */
export async function GET() {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/account?discord_error=not_configured", process.env.APP_URL!),
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // For now, sign-in flow requires an existing iKratom account.
    // We could one day support full Discord signup; that needs more
    // thought (email verification, profile bootstrap, etc.).
    return NextResponse.redirect(
      new URL("/signup?discord_link=must_signup_first", process.env.APP_URL!),
    );
  }

  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("d_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const redirectUri = `${process.env.APP_URL}/api/oauth/discord/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify email",
    state,
    prompt: "consent",
  });

  return NextResponse.redirect(
    `https://discord.com/api/oauth2/authorize?${params.toString()}`,
  );
}
