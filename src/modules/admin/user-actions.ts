"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

  // Read CURRENT role state so we can detect transitions (false → true)
  // and fire the appropriate notification + tutorial flag exactly once
  // per promotion. Without this we'd re-notify on every role-toggle save.
  const { data: prev } = await supabase
    .from("profiles")
    .select("is_advocate_leader, is_admin, is_owner")
    .eq("id", input.userId)
    .single();

  // Set leader_tour_pending = true ONLY when leader transitions to true.
  // The tutorial component on /dashboard reads + clears this flag.
  const newlyLeader = !!input.isLeader && !prev?.is_advocate_leader;
  const newlyAdmin = !!input.isAdmin && !prev?.is_admin;
  const newlyOwner = ctx.isOwner && input.isOwner === true && !prev?.is_owner;

  const fullUpdate: Record<string, unknown> = { ...updates };
  if (newlyLeader) fullUpdate.leader_tour_pending = true;

  const { error } = await supabase.from("profiles").update(fullUpdate).eq("id", input.userId);
  if (error) return { error: error.message };

  // Fire role-promotion notifications via service-role client (we're
  // writing to another user's notifications row). Best-effort — never
  // blocks the role change. Realtime publication on `notifications`
  // means the user's bell icon updates within seconds.
  if (newlyLeader || newlyAdmin || newlyOwner) {
    try {
      const sr = createServiceRoleClient();
      const rows: Array<{ user_id: string; kind: string; title: string; body: string; link: string }> = [];
      if (newlyLeader) {
        rows.push({
          user_id: input.userId,
          kind: "role_granted_leader",
          title: "🎖 You're now an Advocate Leader",
          body:
            "You can author campaigns, moderate the forum, and access the leader workshop. " +
            "Your dashboard will walk you through what's new on your next visit.",
          link: "/dashboard",
        });
      }
      if (newlyAdmin) {
        rows.push({
          user_id: input.userId,
          kind: "role_granted_admin",
          title: "🛠 You're now an Admin",
          body: "Full moderation + sync + user-management access. Visit /admin to see the control room.",
          link: "/admin",
        });
      }
      if (newlyOwner) {
        rows.push({
          user_id: input.userId,
          kind: "role_granted_owner",
          title: "👑 You're now an Owner",
          body: "Highest-privilege role — only one owner at a time. Hand-off complete.",
          link: "/admin",
        });
      }
      if (rows.length > 0) await sr.from("notifications").insert(rows);
    } catch {
      // non-fatal
    }
  }

  await recordAdminAction({
    action: "role_change",
    targetType: "user",
    targetId: input.userId,
    details: { ...fullUpdate, newly_leader: newlyLeader, newly_admin: newlyAdmin, newly_owner: newlyOwner },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Called by the dashboard's leader tutorial after the user finishes (or
 * skips) the walkthrough — clears leader_tour_pending so it doesn't
 * re-fire on every dashboard visit.
 */
export async function clearLeaderTourPending() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { error } = await supabase
    .from("profiles")
    .update({ leader_tour_pending: false })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}
