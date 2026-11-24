import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordAdminAction } from "@/lib/audit";
import { verifyUserForPromotion } from "@/modules/auth/trust-tier";
import type { ChecklistItem } from "@/modules/auth/promotion-checklist";

/**
 * Leader invites (mig 0324). The owner invites; the role applies by itself the
 * first time the member passes verifyUserForPromotion. Server-only on purpose:
 * these helpers take a user id, so they must never be callable from a browser.
 * The callable wrappers in leader-invite-actions.ts pass the session's own id.
 */

/** The bell notice for a new Advocate Leader. One copy, used by every path. */
export const LEADER_GRANTED_NOTIFICATION = {
  kind: "role_granted_leader",
  title: "🎖 You're now an Advocate Leader",
  body:
    "Welcome, and thank you. You can now write campaigns (an admin checks each one before it goes out), " +
    "hide spam and abuse in the forum, approve members' stories, add local officials, and sign people up at events. " +
    "A short walkthrough starts on your next page.",
  link: "/leader",
} as const;

export type InviteRow = {
  user_id: string;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

export function isOpenInvite(row: Pick<InviteRow, "accepted_at" | "revoked_at"> | null | undefined): boolean {
  return !!row && !row.accepted_at && !row.revoked_at;
}

/**
 * Turn the role on: flag, tour, notice. Service role, because the caller has
 * already decided this person may have it. Returns an error string or null.
 */
export async function grantLeaderRole(userId: string): Promise<string | null> {
  const sr = createServiceRoleClient();
  const { error } = await sr
    .from("profiles")
    .update({ is_advocate_leader: true, leader_tour_pending: true })
    .eq("id", userId);
  if (error) return error.message;
  const { error: nErr } = await sr.from("notifications").insert({ user_id: userId, ...LEADER_GRANTED_NOTIFICATION });
  if (nErr) console.error("[leader-invite] notification insert failed:", nErr.message);
  return null;
}

export type ApplyResult =
  | { state: "none" }
  | { state: "already" }
  | { state: "waiting"; items: ChecklistItem[] }
  | { state: "applied" }
  | { state: "error"; message: string };

/**
 * If this member holds an open invite and now passes every check, make them a
 * leader. Idempotent: the invite is claimed with a compare-and-set, so two tabs
 * landing at once grant the role once. Called from the member's own session
 * (dashboard, /leader/invite), so the audit row's actor is the member, with the
 * inviter recorded in details.
 */
export async function applyLeaderInviteIfReady(userId: string): Promise<ApplyResult> {
  const sr = createServiceRoleClient();
  const { data: invite } = await sr
    .from("leader_invites")
    .select("user_id, invited_by, invited_at, accepted_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!invite || invite.revoked_at) return { state: "none" };
  if (invite.accepted_at) return { state: "already" };

  const { data: prof } = await sr
    .from("profiles")
    .select("is_advocate_leader, is_admin, is_owner, account_locked_at")
    .eq("id", userId)
    .maybeSingle();
  if (!prof || prof.account_locked_at) return { state: "none" };
  if (prof.is_advocate_leader || prof.is_admin || prof.is_owner) {
    await sr.from("leader_invites").update({ accepted_at: new Date().toISOString() }).eq("user_id", userId).is("accepted_at", null);
    return { state: "already" };
  }

  const v = await verifyUserForPromotion(userId);
  if (!v.ok) return { state: "waiting", items: v.items };

  // Claim first, then grant: the claim is the lock.
  const { data: claimed } = await sr
    .from("leader_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("user_id");
  if (!claimed || claimed.length === 0) return { state: "already" };

  const err = await grantLeaderRole(userId);
  if (err) {
    // Release the claim so the next visit tries again.
    await sr.from("leader_invites").update({ accepted_at: null }).eq("user_id", userId);
    return { state: "error", message: err };
  }

  await recordAdminAction({
    action: "leader_invite_applied",
    targetType: "user",
    targetId: userId,
    details: { invited_by: invite.invited_by, invited_at: invite.invited_at },
  });
  return { state: "applied" };
}

/** The member's own invite, for the checklist page and dashboard card. */
export async function readLeaderInvite(userId: string): Promise<InviteRow | null> {
  const sr = createServiceRoleClient();
  const { data } = await sr
    .from("leader_invites")
    .select("user_id, invited_by, invited_at, accepted_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as InviteRow | null) ?? null;
}
