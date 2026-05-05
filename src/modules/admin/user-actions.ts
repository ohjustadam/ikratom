"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";
import { getAdminContext } from "./actions";
import { requireMfaForMutation } from "./mfa";

/**
 * Set a user's role flags.
 * Strict admin only — owner can grant any flag; admins can grant `is_admin` and
 * `is_advocate_leader` but cannot transfer ownership.
 */
export async function setUserRoles(input: {
  userId: string;
  isAdmin: boolean;
  isLeader: boolean;
  isOwner?: boolean; // owner-only — ignored for non-owner callers
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  if (!input.userId) return { error: "Missing user id." };
  if (input.userId === ctx.userId && !input.isAdmin && !input.isOwner) {
    return { error: "You cannot demote yourself. Ask another owner/admin." };
  }

  const updates: Record<string, boolean> = {
    is_admin: !!input.isAdmin,
    is_advocate_leader: !!input.isLeader,
  };
  if (ctx.isOwner && typeof input.isOwner === "boolean") {
    updates.is_owner = input.isOwner;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(updates).eq("id", input.userId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "role_change",
    targetType: "user",
    targetId: input.userId,
    details: updates,
  });

  revalidatePath("/admin/users");
  return { ok: true };
}
