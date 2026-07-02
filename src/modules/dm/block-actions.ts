"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function blockUser(targetUserId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (targetUserId === user.id) return { error: "Can't block yourself." };

  const { error } = await supabase
    .from("user_blocks")
    .upsert({ blocker_id: user.id, blocked_id: targetUserId });
  if (error) return { error: error.message };
  revalidatePath("/messages");
  return { ok: true };
}

export async function unblockUser(targetUserId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", targetUserId);
  if (error) return { error: error.message };
  revalidatePath("/messages");
  return { ok: true };
}

export async function listBlockedUsers() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // get_my_blocked_profiles (SECURITY DEFINER, 0228): the caller's OWN blocked
  // users, public-safe columns only, IGNORING profile_visibility — so a blocked
  // user who set their profile non-public still appears and can be unblocked.
  // (get_public_profiles would silently drop them → orphaned, unremovable block.)
  const { data: blocked } = await supabase.rpc("get_my_blocked_profiles");

  return ((blocked ?? []) as { id: string; username: string | null; state: string | null; created_at: string | null }[])
    .map((b) => ({
      id: b.id,
      username: b.username,
      state: b.state,
      blocked_at: b.created_at,
    }));
}

export async function isBlocked(otherUserId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", user.id)
    .eq("blocked_id", otherUserId)
    .maybeSingle();
  return !!data;
}
