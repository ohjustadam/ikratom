"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";
import { PERMISSION_BY_KEY } from "./permissions";

/**
 * Owner-only server actions for editing per-user granular permissions.
 * Migration 0083 enforces RLS so only owner can write user_permissions
 * rows; this layer adds the validation + audit log.
 */

export async function setUserPermissionOverride(input: {
  userId: string;
  permission: string;
  granted: boolean | null;  // null = remove the override entirely (fall back to role default)
  reason?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!ctx.isOwner) return { error: "Owner only — only the owner can edit permission overrides." };
  if (!input.userId) return { error: "Missing user id." };

  const perm = PERMISSION_BY_KEY[input.permission];
  if (!perm) return { error: `Unknown permission: ${input.permission}` };

  const supabase = await createClient();

  if (input.granted === null) {
    // Remove the explicit override → falls back to role default
    const { error } = await supabase
      .from("user_permissions")
      .delete()
      .eq("user_id", input.userId)
      .eq("permission", input.permission);
    if (error) return { error: error.message };

    await recordAdminAction({
      action: "permission_override_cleared",
      targetType: "user",
      targetId: input.userId,
      details: {
        permission: input.permission,
        reason: input.reason ?? null,
      },
    });
  } else {
    const { error } = await supabase
      .from("user_permissions")
      .upsert({
        user_id: input.userId,
        permission: input.permission,
        granted: input.granted,
        granted_by: ctx.userId,
        reason: (input.reason ?? "").slice(0, 500) || null,
      }, { onConflict: "user_id,permission" });
    if (error) return { error: error.message };

    await recordAdminAction({
      action: input.granted ? "permission_granted" : "permission_revoked",
      targetType: "user",
      targetId: input.userId,
      details: {
        permission: input.permission,
        reason: input.reason ?? null,
      },
    });
  }

  revalidatePath(`/admin/users`);
  revalidatePath(`/admin/users/${input.userId}/permissions`);
  return { ok: true };
}

/**
 * Returns the effective permission set for a user — explicit overrides
 * + role defaults merged. Used by the permissions matrix UI to render
 * each row with the right initial checkbox state + visual indicator
 * (override vs default).
 */
export async function getUserEffectivePermissions(userId: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, is_admin, is_owner, is_advocate_leader")
    .eq("id", userId)
    .single();
  if (!profile) return { error: "User not found." };

  const { data: overrides } = await supabase
    .from("user_permissions")
    .select("permission, granted, reason, granted_by, created_at")
    .eq("user_id", userId);

  return { ok: true, profile, overrides: overrides ?? [] };
}
