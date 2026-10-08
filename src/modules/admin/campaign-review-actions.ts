"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";
import { applyCampaignReviewTransition } from "./campaign-review-shared";

/**
 * Approve a pending auto-generated campaign. Flips active=true,
 * review_state='auto_active'. The notify-users-for-campaign trigger
 * fires on UPDATE only when active flips false→true; we explicitly
 * set active=true so the existing trigger logic catches it.
 */
export async function approvePendingCampaign(campaignId: string) {
  const ctx = await getCreatorContext({ require: "approve_campaigns" });
  if (!ctx.ok) return { error: "Admin or leader only." };
  // Approving PUBLISHES a campaign — including ones the AI stance-screen flagged
  // for human review. The review gate is meaningless if the leader who authored
  // it can self-approve, so the approve action requires admin/owner (a separate
  // party from the authoring leader). Leaders can still reject/supersede.
  // (pen-test SA-01)
  if (!ctx.isAdmin && !ctx.isOwner) {
    return { error: "Only an admin can approve a campaign for publication." };
  }
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const r = await applyCampaignReviewTransition(supabase, {
    ids: [campaignId],
    action: "approve",
    reviewerId: ctx.userId,
  });
  if (r.error) return { error: r.error };

  await recordAdminAction({
    action: "campaign_review_approved",
    targetType: "campaign",
    targetId: campaignId,
  });
  revalidatePath("/admin/campaigns/pending");
  return { ok: true };
}

/**
 * Reject a pending auto-generated campaign. Stays inactive, marked
 * review_state='rejected' so it never auto-revives. Admin can still
 * manually reactivate from the campaign edit page if they change
 * their mind.
 */
export async function rejectPendingCampaign(input: { campaignId: string; reason?: string }) {
  const ctx = await getCreatorContext({ require: "approve_campaigns" });
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const r = await applyCampaignReviewTransition(supabase, {
    ids: [input.campaignId],
    action: "reject",
    reviewerId: ctx.userId,
    reason: input.reason ?? null,
  });
  if (r.error) return { error: r.error };

  await recordAdminAction({
    action: "campaign_review_rejected",
    targetType: "campaign",
    targetId: input.campaignId,
    details: { reason: input.reason ?? null },
  });
  revalidatePath("/admin/campaigns/pending");
  return { ok: true };
}

export async function pendingCampaignCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("review_state", "pending_review");
  return count ?? 0;
}

// ============================================================
// Bulk review actions for /admin/campaigns/pending
// ============================================================

const MAX_BULK = 500;

type BulkAction = "approve" | "reject" | "supersede" | "delete";

/**
 * Run a single action against many pending campaigns at once.
 * Cap: 500 ids per call so admin can't accidentally smash 2000+ rows
 * in one click. UI should chunk if needed.
 *
 * Safety: every UPDATE includes `.eq('review_state','pending_review')`
 * (via applyCampaignReviewTransition) so admins can't accidentally flip
 * already-approved or already-rejected rows back.
 *
 * Audit: one row per affected campaign in admin_audit_log via
 * recordAdminAction(). Lets the audit log surface exactly which bulk
 * sweeps an admin did.
 */
export async function bulkReviewCampaigns(input: {
  ids: string[];
  action: BulkAction;
  reason?: string;
}) {
  const ctx = await getCreatorContext({ require: "approve_campaigns" });
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const validActions: BulkAction[] = ["approve", "reject", "supersede", "delete"];
  if (!validActions.includes(input.action)) {
    return { error: "Unknown action." };
  }
  // Approve/supersede/delete publish or destroy — admin/owner only (a leader
  // must not self-approve their own flagged campaigns). Leaders may bulk-reject.
  // (pen-test SA-01)
  if (input.action !== "reject" && !ctx.isAdmin && !ctx.isOwner) {
    return { error: "Only an admin can approve, supersede, or delete campaigns." };
  }
  const ids = (input.ids ?? []).filter(
    (s) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s)
  );
  if (ids.length === 0) return { error: "No campaigns selected." };
  if (ids.length > MAX_BULK) {
    return { error: `Too many at once. Cap is ${MAX_BULK}; got ${ids.length}.` };
  }
  // Cap reason length so it doesn't blow up the column.
  const reason = (input.reason ?? "").slice(0, 500) || null;

  const supabase = await createClient();

  let affected = 0;

  if (input.action === "delete") {
    // Hard-delete is only safe for pending rows that NEVER went active
    // (no user actions exist against them). campaign_actions FK is
    // ON DELETE CASCADE; we still gate on review_state for safety so
    // an admin can't bulk-delete approved campaigns by mistake.
    const { data, error } = await supabase
      .from("campaigns")
      .delete()
      .in("id", ids)
      .eq("review_state", "pending_review")
      .select("id");
    if (error) return { error: error.message };
    affected = data?.length ?? 0;
  } else {
    const r = await applyCampaignReviewTransition(supabase, {
      ids,
      action: input.action,
      reviewerId: ctx.userId,
      reason,
    });
    if (r.error) return { error: r.error };
    affected = r.affected;
  }

  // Per-row audit — useful for the audit-log timeline view. Cap
  // logging at affected count so we don't spam audit_log on a bulk
  // sweep beyond what actually changed.
  await Promise.all(
    ids.slice(0, affected).map((id) =>
      recordAdminAction({
        action: `campaign_bulk_${input.action}`,
        targetType: "campaign",
        targetId: id,
        details: { reason },
      })
    )
  );

  revalidatePath("/admin/campaigns/pending");
  return { ok: true, affected };
}
