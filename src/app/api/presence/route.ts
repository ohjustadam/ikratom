import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/presence — stamp profiles.last_seen_at for the signed-in member
 * (touch_last_seen(), migration 0240; it self-throttles and no-ops when
 * signed out). Feeds the owner's "who's online · last 5 min" view.
 *
 * A route, not a server action: action ids can change with a deploy, and a tab
 * opened before one kept POSTing a dead action every minute (187 x 404 from the
 * owner's dashboard tab on 2026-10-07). A URL survives every deploy.
 */
export async function POST() {
  try {
    const sb = await createClient();
    await sb.rpc("touch_last_seen");
  } catch {
    // Presence is best-effort.
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
