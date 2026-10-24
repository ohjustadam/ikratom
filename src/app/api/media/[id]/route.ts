import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signedMemberPhotoUrl } from "@/lib/media-store";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/media/<photo id> — the ONLY way a member photo is read.
 *
 * get_media_object (0286) runs as THIS viewer and returns the storage key only
 * when can_view_audience allows it. Not allowed, removed, or never existed all
 * look the same: 404, so a hidden photo's existence is never confirmed.
 * Allowed: 302 to a 10-minute signed R2 URL, so the bytes come from R2 (free
 * egress) and never pass through a Netlify function. The redirect is private
 * to this browser (per-viewer decision) and is re-used for 5 minutes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () =>
    new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  if (!UUID_RE.test(id)) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_media_object", { p_id: id });
  const row = ((data ?? []) as { r2_key: string; content_type: string; audience: string }[])[0];
  if (error || !row) return notFound();

  try {
    const url = await signedMemberPhotoUrl(row.r2_key, row.content_type);
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: url,
        "Cache-Control": "private, max-age=300",
        Vary: "Cookie",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": row.audience === "public" ? "all" : "noindex",
      },
    });
  } catch {
    return new NextResponse("Photo storage unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
