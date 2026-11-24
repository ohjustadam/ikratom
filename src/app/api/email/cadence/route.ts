import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";

/**
 * /api/email/cadence?u=<user id>&t=<token>&d=weekly|daily
 *
 * The one-click "get this once a week" / "every day again" link in the email
 * digest (scripts/lib/email-render.mjs cadenceNote). It reuses the unsubscribe
 * HMAC on purpose: that token can already turn email off, and this route can
 * only set THIS member's digest cadence to daily or weekly. It never reads
 * anything, never turns email on or off, and leaves push and in-app alone.
 *
 * GET only, no one-click POST: mail scanners that prefetch links issue GETs,
 * and the worst a prefetch can do here is pick the cadence the link names.
 */
export const dynamic = "force-dynamic";

async function setCadence(req: NextRequest): Promise<"weekly" | "daily" | null> {
  const u = req.nextUrl.searchParams.get("u");
  const t = req.nextUrl.searchParams.get("t");
  const d = req.nextUrl.searchParams.get("d");
  if (d !== "weekly" && d !== "daily") return null;
  if (!verifyUnsubscribe(u, t)) return null;
  const sb = createServiceRoleClient();
  const { data, error } = await sb.from("notification_preferences")
    .update({ digest: d, updated_at: new Date().toISOString() })
    .eq("user_id", u!).neq("digest", "off").select("user_id");
  return !error && data?.length ? d : null;
}

export async function GET(req: NextRequest) {
  const done = await setCadence(req);
  const title = done === "weekly" ? "You'll get iKratom email once a week" : done === "daily" ? "You'll get iKratom email every day" : "That link didn't work";
  const body = done === "weekly"
    ? "Your summary now comes on Mondays. Hearing alerts still come when a hearing is set."
    : done === "daily"
      ? "Your summary comes every morning again."
      : "The link may be incomplete, or notifications are off for your account. You can change how often you hear from us in your settings.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iKratom email</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#14171c">
<h1 style="font-size:22px">${title}</h1>
<p>${body}</p>
<p><a href="/account" style="color:#1a7f4b">Notification settings</a></p>
</body></html>`;
  return new NextResponse(html, { status: done ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
