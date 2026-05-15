import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";
import { recordAuthEvent } from "@/lib/auth-events";

/**
 * Discord OAuth callback. Validates CSRF state, exchanges the auth
 * code for a token, fetches the user's identity, and writes the
 * Discord fields onto the signed-in user's profile.
 *
 * We DON'T store the Discord access token — once we have the user's
 * ID + username + avatar, that's all we need for Phase 2. (Phase 4 bot
 * features that need server membership lookup are a separate flow.)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent") ?? null;

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("d_oauth_state")?.value;
  cookieStore.delete("d_oauth_state");

  if (errorParam) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "discord", status: "fail",
      errorCode: errorParam, ip, userAgent,
    });
    return NextResponse.redirect(
      new URL(`/account?discord_error=${encodeURIComponent(errorParam)}`, process.env.APP_URL!),
    );
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    await recordAuthEvent({
      kind: "oauth_callback", provider: "discord", status: "fail",
      errorCode: "state_mismatch", ip, userAgent,
    });
    return NextResponse.redirect(
      new URL("/account?discord_error=state_mismatch", process.env.APP_URL!),
    );
  }

  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/account?discord_error=not_configured", process.env.APP_URL!),
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/login?redirect=/account&discord_error=not_signed_in", process.env.APP_URL!),
    );
  }

  // Exchange code → access token
  const redirectUri = `${process.env.APP_URL}/api/oauth/discord/callback`;
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    await recordAuthEvent({
      kind: "oauth_callback", provider: "discord", status: "fail",
      errorCode: "token_exchange_failed", errorMessage: errBody.slice(0, 400),
      userId: user.id, email: user.email, ip, userAgent,
    });
    return NextResponse.redirect(
      new URL("/account?discord_error=token_exchange_failed", process.env.APP_URL!),
    );
  }
  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Fetch identity
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!meRes.ok) {
    return NextResponse.redirect(
      new URL("/account?discord_error=identity_fetch_failed", process.env.APP_URL!),
    );
  }
  const me = (await meRes.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  // Compose avatar URL (Discord CDN, animated for a_-prefixed hashes)
  const avatarUrl = me.avatar
    ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}${me.avatar.startsWith("a_") ? ".gif" : ".png"}?size=128`
    : null;

  // Reject if THIS Discord ID is already linked to a different account.
  // The unique partial index would error on the update; this gives a
  // cleaner error path.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("discord_id", me.id)
    .neq("id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.redirect(
      new URL("/account?discord_error=already_linked_other", process.env.APP_URL!),
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      discord_id: me.id,
      discord_username: me.global_name ?? me.username,
      discord_avatar_url: avatarUrl,
      discord_linked_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) {
    return NextResponse.redirect(
      new URL("/account?discord_error=save_failed", process.env.APP_URL!),
    );
  }

  await recordAdminAction({
    action: "user.discord_link",
    targetType: "user",
    targetId: user.id,
    details: { discord_username: me.global_name ?? me.username },
  });
  await recordAuthEvent({
    kind: "discord_connect", provider: "discord", status: "ok",
    userId: user.id, email: user.email, ip, userAgent,
    context: { discord_username: me.global_name ?? me.username },
  });

  return NextResponse.redirect(
    new URL("/account?discord_connected=1", process.env.APP_URL!),
  );
}
