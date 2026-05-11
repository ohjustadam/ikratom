"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Stamp profiles.tour_seen[surface] = now() so the TourTooltip
 * component skips on future visits to the same surface.
 *
 * tour_seen is a jsonb map of {surface: iso-timestamp}. Migration
 * 0075 added the column with default '{}'::jsonb.
 *
 * Safe for anonymous (no-op when no user session). Idempotent —
 * re-marking a surface just updates the timestamp.
 */
export async function markTourSurfaceSeen(surface: string) {
  if (!surface || typeof surface !== "string" || surface.length > 60) {
    return { error: "Invalid surface." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true }; // anonymous — silently succeed

  // Read-modify-write the jsonb. Simpler than a custom RPC.
  const { data: prof } = await supabase
    .from("profiles")
    .select("tour_seen")
    .eq("id", user.id)
    .single();

  const current = (prof?.tour_seen as Record<string, string> | null) ?? {};
  const updated = { ...current, [surface]: new Date().toISOString() };

  const { error } = await supabase
    .from("profiles")
    .update({ tour_seen: updated })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Returns the tour_seen map for the current user, or {} for anonymous.
 * Components use the keys to decide whether to fire their tooltip.
 */
export async function getTourSeen(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data: prof } = await supabase
    .from("profiles")
    .select("tour_seen")
    .eq("id", user.id)
    .single();
  return (prof?.tour_seen as Record<string, string> | null) ?? {};
}

/**
 * Reset all tour tooltips so they fire again. Used by the "replay
 * onboarding" button on /account.
 */
export async function resetTourSeen() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { error } = await supabase
    .from("profiles")
    .update({ tour_seen: {} })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}
