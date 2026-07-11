"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Presence heartbeat — stamps profiles.last_seen_at for the signed-in user
 * (via touch_last_seen(), migration 0240). Fire-and-forget from the client;
 * the RPC self-throttles to one write per ~50s and no-ops when signed out.
 */
export async function heartbeat(): Promise<void> {
  try {
    const sb = await createClient();
    await sb.rpc("touch_last_seen");
  } catch {
    // Presence is best-effort — never surface an error to the user.
  }
}
