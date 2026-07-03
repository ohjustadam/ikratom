// src/modules/admin/campaign-review-shared.ts
// PLAIN module (deliberately NOT "use server"): the canonical campaign review-
// state column shapes + the one shared guarded write. These live here, not in
// campaign-review-actions.ts, because a "use server" module may export ONLY
// async functions (tests/use-server-exports.test.ts) — exporting these const
// values from there would 500 the app (digest @E352 class of bug).
//
// APPROVE_COLUMNS / REJECT_COLUMNS / SUPERSEDE_COLUMNS are asserted in
// tests/campaign-autoapprove.test.ts to deep-equal the auto-approve engine's
// scripts/lib/campaign-review-columns.mjs constants — so an AUTOMATIC approve
// (auto-approve-campaigns.mjs) writes EXACTLY what a MANUAL approve does, and
// the two can never silently drift.

import type { SupabaseClient } from "@supabase/supabase-js";

export const APPROVE_COLUMNS = { active: true, review_state: "auto_active" } as const;
export const REJECT_COLUMNS = { active: false, review_state: "rejected" } as const;
export const SUPERSEDE_COLUMNS = { active: false, review_state: "superseded" } as const;

export type ReviewAction = "approve" | "reject" | "supersede";

/**
 * The ONE guarded write shared by manual single review and bulk review. Only
 * flips rows still in pending_review (race guard: affected=0 means a human
 * already handled it). Always stamps reviewed_at + reviewed_by (reviewerId=null
 * = system action) — resolving the old single-vs-bulk inconsistency where the
 * single approve/reject path never recorded who/when.
 */
export async function applyCampaignReviewTransition(
  supabase: SupabaseClient,
  input: {
    ids: string[];
    action: ReviewAction;
    reviewerId: string | null;
    reason?: string | null;
    supersededBy?: string | null;
    /**
     * Approve WITHOUT firing the per-campaign user notification. Set by the
     * bulk/auto queue-resolvers so clearing a backlog never spams — the
     * campaign_notify trigger honors campaigns.suppress_notify (migration 0231).
     * A deliberate single manual approve leaves this false so it still notifies.
     */
    suppressNotify?: boolean;
  },
): Promise<{ affected: number; error?: string }> {
  const base =
    input.action === "approve"
      ? APPROVE_COLUMNS
      : input.action === "reject"
        ? REJECT_COLUMNS
        : SUPERSEDE_COLUMNS;
  const patch: Record<string, unknown> = {
    ...base,
    reviewed_at: new Date().toISOString(),
    reviewed_by: input.reviewerId,
    review_reason: input.reason ?? null,
  };
  if (input.action === "approve" && input.suppressNotify) {
    patch.suppress_notify = true;
  }
  if (input.action === "supersede" && input.supersededBy) {
    patch.superseded_by = input.supersededBy;
  }
  const { data, error } = await supabase
    .from("campaigns")
    .update(patch)
    .in("id", input.ids)
    .eq("review_state", "pending_review")
    .select("id");
  if (error) return { affected: 0, error: error.message };
  return { affected: data?.length ?? 0 };
}
