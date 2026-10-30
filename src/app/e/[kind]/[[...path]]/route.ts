import { NextResponse, type NextRequest } from "next/server";
import { clickTarget } from "@/lib/email-click";

/**
 * /e/<kind>/<page> — the link every member email uses, so Cloudflare can count
 * clicks per kind of email (scripts/email-clicks.mjs). It lands the reader on
 * <page> and records nothing itself: no cookie, no database write, no user id.
 * clickTarget keeps the destination on iKratom (no open redirect).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string; path?: string[] }> }) {
  const { path } = await params;
  const to = new URL(clickTarget(path, req.nextUrl.search), req.url);
  if (to.origin !== new URL(req.url).origin) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(to, 302);
}
