"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Show or hide yourself on your group's leaderboard (migration 0294). Off by
 * default; the RPC only ever touches the caller's own membership row.
 */
export async function setLeaderboardOptIn(coalitionId: string, slug: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(coalitionId)) return { ok: false, error: "Group not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!(await checkRateLimit(`coalition:leaderboard:${user.id}`, 20, 3600))) {
    return { ok: false, error: "Too many changes this hour. Try again later." };
  }
  const { data, error } = await supabase.rpc("set_coalition_leaderboard", { p_coalition_id: coalitionId, p_on: !!on });
  if (error || data !== true) return { ok: false, error: "Only members of this group can do that." };
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}
