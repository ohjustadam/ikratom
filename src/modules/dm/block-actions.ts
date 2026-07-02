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

  const { data: blocks } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id);
  if (!blocks || blocks.length === 0) return [];

  const ids = blocks.map((b) => b.blocked_id);
  // Public anonymity: never read another user's full_name/email directly
  // (profiles RLS would even return them to an admin blocker). get_public_profiles
  // (SECURITY DEFINER) returns public-safe columns only; render via publicHandle.
  const { data: profiles } = await supabase.rpc("get_public_profiles", { p_ids: ids });

  return (profiles ?? []).map((p: { id: string; username: string | null; state: string | null }) => ({
    id: p.id,
    username: p.username,
    state: p.state,
    blocked_at: blocks.find((b) => b.blocked_id === p.id)?.created_at ?? null,
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
