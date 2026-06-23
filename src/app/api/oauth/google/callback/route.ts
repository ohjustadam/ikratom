import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAuthEvent } from "@/lib/auth-events";
import { encryptToken } from "@/lib/token-crypto";

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  if (error) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: error, errorMessage: url.searchParams.get("error_description"),
      ip, userAgent,
    });
    return NextResponse.redirect(new URL(`/account?gmail_error=${error}`, APP_URL));
  }
  if (!code || !state) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "missing_code", ip, userAgent,
    });
    return NextResponse.redirect(new URL("/account?gmail_error=missing_code", APP_URL));
  }

  // Validate CSRF state
  const cookieStore = await cookies();
  const expected = cookieStore.get("g_oauth_state")?.value;
  cookieStore.delete("g_oauth_state");
  if (!expected || expected !== state) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "bad_state", ip, userAgent,
    });
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
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "token_fetch", userId: user.id, email: user.email, ip, userAgent,
    });
    return NextResponse.redirect(new URL("/account?gmail_error=token_fetch", APP_URL));
  }
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "token_exchange", errorMessage: errBody.slice(0, 400),
      userId: user.id, email: user.email, ip, userAgent,
    });
    return NextResponse.redirect(new URL("/account?gmail_error=token_exchange", APP_URL));
  }
  const tokenData = await tokenRes.json();
  const refreshToken: string | undefined = tokenData.refresh_token;
  const accessToken: string | undefined = tokenData.access_token;
  const scope: string = tokenData.scope ?? "";
  if (!refreshToken) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "no_refresh", userId: user.id, email: user.email, ip, userAgent,
    });
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
        refresh_token: encryptToken(refreshToken), // at-rest encrypt (oauth-02)
        scopes: scope,
        connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "user_id" }
    );

  if (writeErr) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "db_write", errorMessage: writeErr.message,
      userId: user.id, email: user.email, ip, userAgent,
    });
    return NextResponse.redirect(new URL("/account?gmail_error=db_write", APP_URL));
  }

  await recordAuthEvent({
    kind: "gmail_connect", provider: "gmail", status: "ok",
    userId: user.id, email: accountEmail || user.email, ip, userAgent,
  });
  return NextResponse.redirect(new URL("/account?gmail_connected=1", APP_URL));
}
