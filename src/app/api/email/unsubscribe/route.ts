import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";

/**
 * /api/email/unsubscribe?u=<user id>&t=<token>
 *
 * GET  — the link in every email's footer: turns email off, shows a short page.
 * POST — RFC 8058 one-click (List-Unsubscribe-Post), sent by Gmail/Yahoo
 *        without the member ever opening the page. Must not require a login.
 *
 * The HMAC token (src/lib/email/unsubscribe.ts) is the authorization: it can
 * only flip THIS user's email preference off. It cannot read anything, and it
 * never touches push or in-app notifications.
 */
export const dynamic = "force-dynamic";

async function turnOff(req: NextRequest): Promise<boolean> {
  const u = req.nextUrl.searchParams.get("u");
  const t = req.nextUrl.searchParams.get("t");
  if (!verifyUnsubscribe(u, t)) return false;
  const sb = createServiceRoleClient();
  const { error } = await sb.from("notification_preferences").update({ email: false, updated_at: new Date().toISOString() }).eq("user_id", u!);
  return !error;
}

export async function POST(req: NextRequest) {
  return (await turnOff(req)) ? new NextResponse(null, { status: 200 }) : new NextResponse("invalid link", { status: 400 });
}

export async function GET(req: NextRequest) {
  const ok = await turnOff(req);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iKratom email</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#14171c">
<h1 style="font-size:22px">${ok ? "You're unsubscribed from iKratom email" : "That link didn't work"}</h1>
<p>${ok ? "You won't get any more iKratom emails. Hearings, alerts and news are still waiting inside the site, and push notifications are unchanged." : "The link may be incomplete. You can turn email off in your settings instead."}</p>
<p><a href="/account" style="color:#1a7f4b">${ok ? "Changed your mind? Turn email back on" : "Open notification settings"}</a></p>
</body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
