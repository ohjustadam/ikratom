"use server";

import { createClient } from "@/lib/supabase/server";
import { syncStateLegislators } from "@/lib/sync/openstates";
import { recordAdminAction } from "@/lib/audit";
import { getAdminContext } from "./actions";

/**
 * Re-sync legislators for one state from OpenStates.
 * Admin-only. Uses the user's session — RLS policy `legislators_admin_all`
 * authorizes the writes, no service role needed.
 */
export async function syncOneStateLegislators(state: string) {
  const ctx = await getAdminContext({ require: "sync_legislators" });
  if (!ctx.ok) return { error: "Admin only." };

  const abbr = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(abbr)) return { error: "Invalid state code." };

  const apiKey = process.env.OPENSTATES_API_KEY;
  if (!apiKey) return { error: "OPENSTATES_API_KEY not set on server." };

  const supabase = await createClient();
  const result = await syncStateLegislators(abbr, supabase, apiKey);

  if (result.error) return { error: result.error };

  await recordAdminAction({
    action: "sync_legislators",
    targetType: "legislator",
    details: { state: abbr, count: result.count },
  });

  return { count: result.count };
}
