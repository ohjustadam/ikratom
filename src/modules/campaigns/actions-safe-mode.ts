"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/** Save the member's banned-state safe-mode choice (migration 0275). */
export async function setBannedStateSafeMode(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!(await checkRateLimit(`safe-mode:${user.id}`, 10, 3600))) {
    return { ok: false, error: "Slow down a moment, then try again." };
  }
  // .select() so an RLS no-op (0 rows) reads as a failure, not a success.
  const { data, error } = await supabase
    .from("profiles")
    .update({ banned_state_safe_mode: on === true })
    .eq("id", user.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't save that. Try again." };
  return { ok: true };
}
