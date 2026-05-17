import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAuthEvent } from "@/lib/auth-events";

/**
 * Microsoft 365 / Outlook OAuth callback. Mirrors the Google one:
 *   - validate CSRF state cookie
 *   - exchange code for tokens at login.microsoftonline.com
 *   - fetch the user's email from Microsoft Graph /me
 *   - upsert email_integrations with provider='outlook'
 *
 * One user → one row (PK on user_id), so connecting Outlook REPLACES any
 * prior Gmail connection. That's intentional — most users have a single
 * "default" send identity and switching providers should be one-click.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");
  const APP_URL = process.env.APP_URL!;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  if (oauthErr) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: oauthErr, errorMessage: url.searchParams.get("error_description"),
      ip, userAgent, context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL(`/account?outlook_error=${oauthErr}`, APP_URL));
  }
  if (!code || !state) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "missing_code", ip, userAgent, context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL("/account?outlook_error=missing_code", APP_URL));
  }

  const cookieStore = await cookies();
  const expected = cookieStore.get("ms_oauth_state")?.value;
  cookieStore.delete("ms_oauth_state");
  if (!expected || expected !== state) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "bad_state", ip, userAgent, context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL("/account?outlook_error=bad_state", APP_URL));
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?redirect=/account", APP_URL));
  }

  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET!;
  const redirectUri = `${APP_URL}/api/oauth/outlook/callback`;

  // Exchange the authorization code for tokens
  let tokenRes: Response;
  try {
    tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          // Some Azure tenants are pickier about scope being in the
          // token request too; including it is harmless.
          scope: "Mail.Send offline_access User.Read",
        }),
      },
    );
  } catch {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "token_fetch", userId: user.id, email: user.email, ip, userAgent,
      context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL("/account?outlook_error=token_fetch", APP_URL));
  }
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "token_exchange", errorMessage: errBody.slice(0, 400),
      userId: user.id, email: user.email, ip, userAgent,
      context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL("/account?outlook_error=token_exchange", APP_URL));
  }

  const tokenData = await tokenRes.json();
  const refreshToken: string | undefined = tokenData.refresh_token;
  const accessToken: string | undefined = tokenData.access_token;
  const scope: string = tokenData.scope ?? "";
  if (!refreshToken) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "no_refresh", userId: user.id, email: user.email, ip, userAgent,
      context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL("/account?outlook_error=no_refresh", APP_URL));
  }

  // Get the connected mailbox email from Microsoft Graph
  let accountEmail = user.email ?? "";
  try {
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string };
      // `mail` is the canonical mailbox address; userPrincipalName is the
      // login identifier (often the same, sometimes different in work
      // tenants). Prefer `mail` when set.
      if (me.mail) accountEmail = me.mail;
      else if (me.userPrincipalName) accountEmail = me.userPrincipalName;
    }
  } catch {
    // non-fatal — fall back to user's iKratom email
  }

  const adminClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Upsert on user_id PK — replaces any prior Gmail row. Comment in
  // file header explains the design choice.
  const { error: writeErr } = await adminClient
    .from("email_integrations")
    .upsert(
      {
        user_id: user.id,
        provider: "outlook",
        account_email: accountEmail,
        refresh_token: refreshToken,
        scopes: scope,
        connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "user_id" },
    );

  if (writeErr) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "gmail", status: "fail",
      errorCode: "db_write", errorMessage: writeErr.message,
      userId: user.id, email: user.email, ip, userAgent,
      context: { intended_provider: "outlook" },
    });
    return NextResponse.redirect(new URL("/account?outlook_error=db_write", APP_URL));
  }

  await recordAuthEvent({
    kind: "gmail_connect", provider: "gmail", status: "ok",
    userId: user.id, email: accountEmail || user.email, ip, userAgent,
    context: { intended_provider: "outlook" },
  });
  return NextResponse.redirect(new URL("/account?outlook_connected=1", APP_URL));
}
