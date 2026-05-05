import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * OAuth callback. Validates state token, exchanges code for tokens, stores
 * the refresh token in email_integrations.
 *
 * Uses service-role client for the write because email_integrations has no
 * INSERT policy (writes go through us, not the client). We still scope to
 * the authenticated user_id read via the user-session cookie.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const APP_URL = process.env.APP_URL!;

  if (error) {
    return NextResponse.redirect(new URL(`/account?gmail_error=${error}`, APP_URL));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/account?gmail_error=missing_code", APP_URL));
  }

  // Validate CSRF state
  const cookieStore = await cookies();
  const expected = cookieStore.get("g_oauth_state")?.value;
  cookieStore.delete("g_oauth_state");
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/account?gmail_error=bad_state", APP_URL));
  }

  // Verify session
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?redirect=/account", APP_URL));
  }

  // Exchange code for tokens
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
  const redirectUri = `${APP_URL}/api/oauth/google/callback`;

  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
  } catch {
    return NextResponse.redirect(new URL("/account?gmail_error=token_fetch", APP_URL));
  }
  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/account?gmail_error=token_exchange", APP_URL));
  }
  const tokenData = await tokenRes.json();
  const refreshToken: string | undefined = tokenData.refresh_token;
  const accessToken: string | undefined = tokenData.access_token;
  const scope: string = tokenData.scope ?? "";
  if (!refreshToken) {
    return NextResponse.redirect(new URL("/account?gmail_error=no_refresh", APP_URL));
  }

  // Get the connected Gmail address using the access token
  let accountEmail = user.email ?? "";
  try {
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      if (profile.email) accountEmail = profile.email;
    }
  } catch {
    // non-fatal — fall back to user's iKratom email
  }

  // Write via service role (no INSERT policy on table)
  const adminClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { error: writeErr } = await adminClient
    .from("email_integrations")
    .upsert(
      {
        user_id: user.id,
        provider: "gmail",
        account_email: accountEmail,
        refresh_token: refreshToken,
        scopes: scope,
        connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "user_id" }
    );

  if (writeErr) {
    return NextResponse.redirect(new URL("/account?gmail_error=db_write", APP_URL));
  }

  return NextResponse.redirect(new URL("/account?gmail_connected=1", APP_URL));
}
