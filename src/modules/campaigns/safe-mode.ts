import type { SupabaseClient } from "@supabase/supabase-js";
import { STATE_NAMES } from "@/lib/state-names";

/**
 * Banned-state safe mode (migration 0275). Active for a member whose profile
 * state bans natural kratom, unless they turned it off.
 */
export type SafeMode = {
  stateName: string;
  /** On unless the member chose off. */
  active: boolean;
  /** false → they haven't chosen yet; the campaign page explains it once. */
  chosen: boolean;
};

/** null when the member's state isn't banned (or unknown). */
export async function getSafeMode(
  supabase: SupabaseClient,
  state: string | null | undefined,
  pref: boolean | null | undefined,
): Promise<SafeMode | null> {
  if (!state) return null;
  const { data } = await supabase
    .from("state_status")
    .select("admin_leaf_status")
    .eq("state", state)
    .maybeSingle();
  if (data?.admin_leaf_status !== "banned") return null;
  return { stateName: STATE_NAMES[state] ?? state, active: pref !== false, chosen: pref === true || pref === false };
}
