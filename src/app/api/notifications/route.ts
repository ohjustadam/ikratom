import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications?limit=20 — the notification flyout's data source.
 *
 * Why a route handler instead of the listNotifications() server action: a
 * server action triggers a full RSC re-render of the calling page as part of
 * its response. When that page render throws, the action POST 500s and the
 * flyout could never load (the "Couldn't load notifications" state). A route
 * handler just returns JSON — no page re-render — so the bell is immune to
 * whatever the page render is doing. Always 200 with { items, error? } so the
 * client degrades gracefully instead of seeing an opaque 500.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ items: [] });

    const raw = Number(new URL(request.url).searchParams.get("limit"));
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, raw) : 20;

    const { data, error } = await supabase
      .from("notifications")
      .select("id, kind, title, body, link, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[api/notifications] query error", error.message);
      return NextResponse.json({ items: [], error: error.message });
    }
    return NextResponse.json({ items: data ?? [] });
  } catch (e) {
    console.error("[api/notifications] failed", e);
    return NextResponse.json({ items: [], error: "load_failed" });
  }
}
