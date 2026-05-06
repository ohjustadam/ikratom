"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { recordAdminAction } from "@/lib/audit";

/**
 * Approve a pending auto-generated campaign. Flips active=true,
 * review_state='auto_active'. The notify-users-for-campaign trigger
 * fires on UPDATE only when active flips false→true; we explicitly
 * set active=true so the existing trigger logic catches it.
 */
export async function approvePendingCampaign(campaignId: string) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ active: true, review_state: "auto_active" })
    .eq("id", campaignId)
    .eq("review_state", "pending_review"); // safety: only flip pending rows
  if (error) return { error: error.message };

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
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ active: false, review_state: "rejected" })
    .eq("id", input.campaignId)
    .eq("review_state", "pending_review");
  if (error) return { error: error.message };

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
