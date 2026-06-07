// scripts/lib/campaign-review-columns.mjs
// Canonical column shapes for a campaign review-state transition. Shared by the
// auto-approve engine (scripts/auto-approve-campaigns.mjs) and asserted, in
// tests/campaign-autoapprove.test.ts, to deep-equal the TS constant exported
// from src/modules/admin/campaign-review-actions.ts — so an AUTOMATIC approve
// writes EXACTLY what a MANUAL approve does and the two can never silently drift.
//
// reviewed_at (now) and reviewed_by (null = system action) are stamped at write
// time; these are the STATIC columns that define each action.

export const APPROVE_COLUMNS = { active: true, review_state: "auto_active" };
export const REJECT_COLUMNS = { active: false, review_state: "rejected" };
export const SUPERSEDE_COLUMNS = { active: false, review_state: "superseded" };
