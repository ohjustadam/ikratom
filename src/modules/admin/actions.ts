"use server";

import { createClient } from "@/lib/supabase/server";
import { hasMfaBypass } from "@/modules/auth/actions-backup-codes";

export type AdminCheck =
  | {
      ok: true;
      userId: string;
      email: string | null;
      isOwner: boolean;
      isAdmin: boolean;
      isLeader: boolean;
      /** Current session AAL ("aal1" or "aal2"). */
      aal: "aal1" | "aal2" | null;
      /** Highest AAL the user could reach. "aal2" iff they have a verified factor. */
      aalNext: "aal1" | "aal2" | null;
      /** True if user redeemed a backup code in the last hour (cookie-based). */
      mfaBypass: boolean;
    }
  | { ok: false; reason: "not_signed_in" | "not_admin" };

export type CreatorCheck =
  | {
      ok: true;
      userId: string;
      email: string | null;
      isOwner: boolean;
      isAdmin: boolean;
      isLeader: boolean;
      aal: "aal1" | "aal2" | null;
      aalNext: "aal1" | "aal2" | null;
      mfaBypass: boolean;
    }
  | { ok: false; reason: "not_signed_in" | "not_creator" };

/**
 * Counts of pending items across admin queues. Used on /admin to
 * surface "X pending" badges on the relevant cards so the admin can
 * see at-a-glance what needs attention without clicking every surface.
 * Each count is best-effort — any subquery failure falls back to 0
 * for that queue, so the dashboard never crashes on an upstream issue.
 */
export type AdminQueueCounts = {
  forum: number;
  campaigns: number;
  localRepRequests: number;
  vendorApplications: number;
  stories: number;
  loungeBanReview: number;
  inactiveDiscord: number;
};

export async function getAdminQueueCounts(): Promise<AdminQueueCounts> {
  const supabase = await createClient();
  const zero: AdminQueueCounts = {
    forum: 0,
    campaigns: 0,
    localRepRequests: 0,
    vendorApplications: 0,
    stories: 0,
    loungeBanReview: 0,
    inactiveDiscord: 0,
  };
  try {
    const [
      { count: forumThreadCount },
      { count: forumPostCount },
      { count: campaignsCount },
      { count: repRequestsCount },
      { count: vendorAppsCount },
      { count: storiesCount },
      banReviewRes,
      { count: inactiveDiscordCount },
    ] = await Promise.all([
      supabase.from("forum_threads").select("id", { count: "exact", head: true })
        .in("moderation_status", ["pending", "auto_flagged", "user_flagged"]),
      supabase.from("forum_posts").select("id", { count: "exact", head: true })
        .in("moderation_status", ["pending", "auto_flagged", "user_flagged"]),
      supabase.from("campaigns").select("id", { count: "exact", head: true })
        .eq("review_state", "pending_review"),
      supabase.from("local_rep_requests").select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase.from("profiles").select("id", { count: "exact", head: true })
        .eq("vendor_status", "pending"),
      supabase.from("kratom_stories").select("id", { count: "exact", head: true })
        .eq("moderation_status", "pending"),
      supabase.rpc("chat_ban_review_queue"),
      supabase.from("discord_integrations").select("id", { count: "exact", head: true })
        .eq("active", false),
    ]);
    const banRows = Array.isArray((banReviewRes as { data?: unknown }).data)
      ? ((banReviewRes as { data: unknown[] }).data.length)
      : 0;
    return {
      forum: (forumThreadCount ?? 0) + (forumPostCount ?? 0),
      campaigns: campaignsCount ?? 0,
      localRepRequests: repRequestsCount ?? 0,
      vendorApplications: vendorAppsCount ?? 0,
      stories: storiesCount ?? 0,
      loungeBanReview: banRows,
      inactiveDiscord: inactiveDiscordCount ?? 0,
    };
  } catch {
    return zero;
  }
}

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

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaBypass = await hasMfaBypass();

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    isOwner,
    isAdmin,
    isLeader,
    aal: (aal?.currentLevel as "aal1" | "aal2" | null) ?? null,
    aalNext: (aal?.nextLevel as "aal1" | "aal2" | null) ?? null,
    mfaBypass,
  };
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

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaBypass = await hasMfaBypass();

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    isOwner,
    isAdmin,
    isLeader,
    aal: (aal?.currentLevel as "aal1" | "aal2" | null) ?? null,
    aalNext: (aal?.nextLevel as "aal1" | "aal2" | null) ?? null,
    mfaBypass,
  };
}

