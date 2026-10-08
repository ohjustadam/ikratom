"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hasMfaBypass } from "@/modules/auth/mfa-bypass";
import { resolvePermissions, type PermissionKey } from "./permissions";

export type AdminCheck =
  | {
      ok: true;
      userId: string;
      email: string | null;
      isOwner: boolean;
      isAdmin: boolean;
      isLeader: boolean;
      /**
       * Effective permissions — role defaults merged with the owner's per-user
       * overrides. A plain array so it stays serializable when a page hands
       * the context to a client component.
       */
      permissions: PermissionKey[];
      /** Current session AAL ("aal1" or "aal2"). */
      aal: "aal1" | "aal2" | null;
      /** Highest AAL the user could reach. "aal2" iff they have a verified factor. */
      aalNext: "aal1" | "aal2" | null;
      /** True if user redeemed a backup code in the last hour (cookie-based). */
      mfaBypass: boolean;
    }
  | { ok: false; reason: "not_signed_in" | "not_admin" | "missing_permission" };

/**
 * Options for the role/permission guards.
 *
 * `require` is the whole point of the granular system: pass a permission key
 * and the guard admits ANYONE who effectively holds it — including an Advocate
 * Leader the owner granted it to individually, who is not an admin at all.
 *
 * Omit it and each guard keeps its historical meaning exactly (admin/owner for
 * getAdminContext, +leader for getCreatorContext). That default is deliberate:
 * introducing permissions cannot silently widen access on a surface nobody has
 * opted in yet. Surfaces become permission-gated one explicit edit at a time.
 */
export type GuardOptions = { require?: PermissionKey };

export type CreatorCheck =
  | {
      ok: true;
      userId: string;
      email: string | null;
      isOwner: boolean;
      isAdmin: boolean;
      isLeader: boolean;
      permissions: PermissionKey[];
      aal: "aal1" | "aal2" | null;
      aalNext: "aal1" | "aal2" | null;
      mfaBypass: boolean;
    }
  | { ok: false; reason: "not_signed_in" | "not_creator" | "missing_permission" };

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
  intelTips: number;
  syncDiscrepancies: number;
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
    intelTips: 0,
    syncDiscrepancies: 0,
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
      { count: intelTipsCount },
      { count: syncDiscrepanciesCount },
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
      // Service-role: chat_ban_review_queue()'s EXECUTE was revoked from
      // authenticated (mig 0236_lock, audit #5), so the user client 400s here
      // and the badge silently reads 0. Admin already gated by getAdminContext
      // in the callers; mirrors listBanReviewQueue's service-role fix (#793).
      createServiceRoleClient().rpc("chat_ban_review_queue"),
      supabase.from("discord_integrations").select("id", { count: "exact", head: true })
        .eq("active", false),
      supabase.from("policy_alerts").select("id", { count: "exact", head: true })
        .eq("moderation_status", "pending"),
      supabase.from("policy_alerts").select("id", { count: "exact", head: true })
        .eq("kind", "scraper_stale")
        .eq("moderation_status", "approved"),
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
      intelTips: intelTipsCount ?? 0,
      syncDiscrepancies: syncDiscrepanciesCount ?? 0,
    };
  } catch {
    return zero;
  }
}

/**
 * Strict admin guard — only owner OR admin. Use for moderating users, role
 * changes, sensitive operations.
 */
export async function getAdminContext(opts?: GuardOptions): Promise<AdminCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const [{ data: profile }, { data: overrideRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_admin, is_owner, is_advocate_leader")
      .eq("id", user.id)
      .single(),
    // Own-row read is allowed by user_permissions_self_read, so this works
    // for a plain Advocate Leader holding an individual grant.
    supabase
      .from("user_permissions")
      .select("permission, granted")
      .eq("user_id", user.id),
  ]);

  const isAdmin = !!profile?.is_admin;
  const isOwner = !!profile?.is_owner;
  const isLeader = !!profile?.is_advocate_leader;

  const permissions = resolvePermissions(
    { isOwner, isAdmin, isLeader },
    (overrideRows ?? []) as { permission: string; granted: boolean }[],
  );

  if (opts?.require) {
    // Permission mode: role is irrelevant, only the effective grant counts.
    if (!permissions.has(opts.require)) return { ok: false, reason: "missing_permission" };
  } else if (!isAdmin && !isOwner) {
    // Legacy mode: unchanged admin-or-owner gate.
    return { ok: false, reason: "not_admin" };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaBypass = await hasMfaBypass();

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    isOwner,
    isAdmin,
    isLeader,
    permissions: [...permissions],
    aal: (aal?.currentLevel as "aal1" | "aal2" | null) ?? null,
    aalNext: (aal?.nextLevel as "aal1" | "aal2" | null) ?? null,
    mfaBypass,
  };
}

/**
 * Looser guard — allows owner, admin, OR advocate-leader. Use for actions
 * leaders should be able to do (create campaigns, add local officials).
 */
export async function getCreatorContext(opts?: GuardOptions): Promise<CreatorCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const [{ data: profile }, { data: overrideRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_admin, is_owner, is_advocate_leader")
      .eq("id", user.id)
      .single(),
    supabase
      .from("user_permissions")
      .select("permission, granted")
      .eq("user_id", user.id),
  ]);

  const isAdmin = !!profile?.is_admin;
  const isOwner = !!profile?.is_owner;
  const isLeader = !!profile?.is_advocate_leader;

  const permissions = resolvePermissions(
    { isOwner, isAdmin, isLeader },
    (overrideRows ?? []) as { permission: string; granted: boolean }[],
  );

  if (opts?.require) {
    if (!permissions.has(opts.require)) return { ok: false, reason: "missing_permission" };
  } else if (!isAdmin && !isOwner && !isLeader) {
    return { ok: false, reason: "not_creator" };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaBypass = await hasMfaBypass();

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    isOwner,
    isAdmin,
    isLeader,
    permissions: [...permissions],
    aal: (aal?.currentLevel as "aal1" | "aal2" | null) ?? null,
    aalNext: (aal?.nextLevel as "aal1" | "aal2" | null) ?? null,
    mfaBypass,
  };
}

