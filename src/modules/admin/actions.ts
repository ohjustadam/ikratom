"use server";

import { createClient } from "@/lib/supabase/server";

export type AdminCheck =
  | { ok: true; userId: string; email: string | null; isOwner: boolean; isAdmin: boolean; isLeader: boolean }
  | { ok: false; reason: "not_signed_in" | "not_admin" };

export type CreatorCheck =
  | { ok: true; userId: string; email: string | null; isOwner: boolean; isAdmin: boolean; isLeader: boolean }
  | { ok: false; reason: "not_signed_in" | "not_creator" };

/**
 * Strict admin guard — only owner OR admin. Use for moderating users, role
 * changes, sensitive operations.
 */
export async function getAdminContext(): Promise<AdminCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();

  const isAdmin = !!profile?.is_admin;
  const isOwner = !!profile?.is_owner;
  const isLeader = !!profile?.is_advocate_leader;

  if (!isAdmin && !isOwner) return { ok: false, reason: "not_admin" };

  return { ok: true, userId: user.id, email: user.email ?? null, isOwner, isAdmin, isLeader };
}

/**
 * Looser guard — allows owner, admin, OR advocate-leader. Use for actions
 * leaders should be able to do (create campaigns, add local officials).
 */
export async function getCreatorContext(): Promise<CreatorCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();

  const isAdmin = !!profile?.is_admin;
  const isOwner = !!profile?.is_owner;
  const isLeader = !!profile?.is_advocate_leader;

  if (!isAdmin && !isOwner && !isLeader) return { ok: false, reason: "not_creator" };

  return { ok: true, userId: user.id, email: user.email ?? null, isOwner, isAdmin, isLeader };
}
