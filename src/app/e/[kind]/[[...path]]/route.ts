import { NextResponse, type NextRequest } from "next/server";
import { clickTarget } from "@/lib/email-click";

/**
 * /e/<kind>/<page> — the link every member email uses, so Cloudflare can count
 * clicks per kind of email (scripts/email-clicks.mjs). It lands the reader on
 * <page> and records nothing itself: no cookie, no database write, no user id.
 * clickTarget keeps the destination on iKratom (no open redirect).
 *
 * The Location is RELATIVE. Behind Cloudflare and Netlify, req.url is the
 * deploy's own address, so the absolute redirect this first shipped with sent
 * readers to <deploy-id>--ikratom.netlify.app, signed out (2026-10-30).
 */
const BASE = "https://ikratom.invalid";

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string; path?: string[] }> }) {
  const { path } = await params;
  const target = clickTarget(path, req.nextUrl.search);
  if (new URL(target, BASE).origin !== BASE) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(null, { status: 302, headers: { Location: target } });
}
