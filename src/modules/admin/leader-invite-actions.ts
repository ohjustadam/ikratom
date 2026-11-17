"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAdminContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { verifyUserForPromotion } from "@/modules/auth/trust-tier";
import { inviteNotificationBody, ownerMissingLine } from "@/modules/auth/promotion-checklist";
import { applyLeaderInviteIfReady, grantLeaderRole, type ApplyResult } from "./leader-invite";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner: invite a member to be an Advocate Leader. If they already pass every
 * check the role applies now; otherwise they get a notice listing what is left
 * and the role applies by itself once they finish (leader-invite.ts).
 */
export async function inviteLeader(input: { userId: string }): Promise<
  { ok: true; applied: boolean; line: string } | { error: string }
> {
  const ctx = await getAdminContext({ require: "manage_roles" });
  if (!ctx.ok) return { error: "Only the owner can invite leaders." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  if (!UUID_RE.test(input.userId ?? "")) return { error: "Missing user id." };
  if (input.userId === ctx.userId) return { error: "You already hold every role." };

  const sr = createServiceRoleClient();
  const { data: prof } = await sr
    .from("profiles")
    .select("is_advocate_leader, is_admin, is_owner, account_locked_at")
    .eq("id", input.userId)
    .maybeSingle();
  if (!prof) return { error: "Member not found." };
  if (prof.account_locked_at) return { error: "This account is locked. Unlock it first." };
  if (prof.is_advocate_leader || prof.is_admin || prof.is_owner) {
    return { error: "They already have a leader role or higher." };
  }

  const v = await verifyUserForPromotion(input.userId);
  const now = new Date().toISOString();

  if (v.ok) {
    const err = await grantLeaderRole(input.userId);
    if (err) return { error: err };
    await sr.from("leader_invites").upsert({
      user_id: input.userId, invited_by: ctx.userId, invited_at: now, accepted_at: now, revoked_at: null,
    });
    await recordAdminAction({
      action: "role_change", targetType: "user", targetId: input.userId,
      details: { is_advocate_leader: true, newly_leader: true, via: "leader_invite" },
    });
    revalidatePath("/admin/users");
    return { ok: true, applied: true, line: "They were already verified, so they're a leader now." };
  }

  const { error } = await sr.from("leader_invites").upsert({
    user_id: input.userId, invited_by: ctx.userId, invited_at: now, accepted_at: null, revoked_at: null,
  });
  if (error) return { error: error.message };

  const { error: nErr } = await sr.from("notifications").insert({
    user_id: input.userId,
    kind: "leader_invite",
    title: "🎖 You're invited to be an Advocate Leader",
    body: inviteNotificationBody(v.items),
    link: "/leader/invite",
  });
  if (nErr) console.error("[leader-invite] notification insert failed:", nErr.message);

  await recordAdminAction({
    action: "leader_invited", targetType: "user", targetId: input.userId,
    details: { missing: v.missing },
  });
  revalidatePath("/admin/users");
  return { ok: true, applied: false, line: `Invited. They ${ownerMissingLine(v.items)}; the role turns on by itself after that.` };
}

/** Owner: withdraw an invite that hasn't applied yet. */
export async function revokeLeaderInvite(input: { userId: string }): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext({ require: "manage_roles" });
  if (!ctx.ok) return { error: "Only the owner can withdraw a leader invite." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  if (!UUID_RE.test(input.userId ?? "")) return { error: "Missing user id." };

  const sr = createServiceRoleClient();
  const { error } = await sr
    .from("leader_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .is("accepted_at", null);
  if (error) return { error: error.message };
  await recordAdminAction({ action: "leader_invite_revoked", targetType: "user", targetId: input.userId });
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Member: check my invite now (the "I've done it" button on /leader/invite). */
export async function claimMyLeaderInvite(): Promise<ApplyResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: "none" };
  if (!(await checkRateLimit(`leader-invite:claim:${user.id}`, 20, 3600))) {
    return { state: "error", message: "Please wait a little and try again." };
  }
  const r = await applyLeaderInviteIfReady(user.id);
  if (r.state === "applied") revalidatePath("/dashboard");
  return r;
}
