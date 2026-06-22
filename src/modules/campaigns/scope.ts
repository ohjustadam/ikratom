/**
 * Campaign recipient-scope membership — the server-side guard that the send /
 * log actions use to confirm a client-supplied legislator actually belongs to
 * the campaign before emailing them on the user's behalf.
 *
 * This MIRRORS the per-user target resolution in `campaigns/[slug]/page.tsx`:
 * the page shapes who the UI offers, and this re-derives the same allowed set
 * server-side so a hand-crafted request can't repurpose a campaign to reach
 * arbitrary officials (defense-in-depth; the send actions otherwise only check
 * `active` + the daily cap + cooldown).
 *
 * Scope is "is this official within the campaign's reach", NOT "is the user a
 * resident": legitimately non-resident sends are allowed (owner policy
 * 2026-06-22 — every campaign is actionable by everyone; out-of-area advocates
 * pick from the campaign-state's officials, which ARE conforming targets).
 * See docs/DECISIONS.md.
 */

export type CampaignScope = {
  /** Explicit curated recipient list — when set, membership IS this set. */
  target_legislator_ids: string[] | null;
  /** Role-based targeting (e.g. state_senate / state_house / us_house). */
  target_roles: string[] | null;
  /** Campaign's state (2-letter) — null for federal / multistate. */
  state: string | null;
  /** Local campaign locality, e.g. "Austin, TX" — null for non-local. */
  target_locality: string | null;
};

/** The minimum a legislator row needs for a scope decision. */
export type ScopeLegislator = {
  id: string;
  role: string;
  state: string | null;
  locality?: string | null;
};

/**
 * Is `leg` a valid recipient for this campaign?
 *
 * Precedence mirrors the page's target resolution:
 *  1. Explicit `target_legislator_ids` → membership is purely that ID set
 *     (the campaign creator hand-picked these officials).
 *  2. Role-based → the role must be one the campaign targets, AND:
 *     - local campaign (`target_locality`)  → locality must match (case-insensitive)
 *     - state campaign (`state`)            → state must match
 *     - federal campaign (no state/locality) → role match is sufficient
 *       (each advocate contacts their own delegation, in any state).
 */
export function legislatorInCampaignScope(
  leg: ScopeLegislator,
  campaign: CampaignScope,
): boolean {
  // 1. Explicit-target campaigns: the curated ID set is the whole answer.
  if (campaign.target_legislator_ids && campaign.target_legislator_ids.length > 0) {
    return campaign.target_legislator_ids.includes(leg.id);
  }

  // 2. Role-based: the role must be targeted.
  const roles = campaign.target_roles ?? [];
  if (!roles.includes(leg.role)) return false;

  // 2a. Local campaign: locality must match (case-insensitive — getUserLegislators
  //     and the picker both canonicalize, but be lenient on casing).
  if (campaign.target_locality) {
    return (leg.locality ?? "").toLowerCase() === campaign.target_locality.toLowerCase();
  }

  // 2b. State campaign: the official must be in the campaign's state.
  if (campaign.state) {
    return leg.state === campaign.state;
  }

  // 2c. Federal campaign (no state, no locality): a matching role is enough.
  return true;
}

/**
 * Filter a set of candidate legislator IDs to those in the campaign's scope.
 *
 * For explicit-target campaigns this needs only the IDs. For role-based
 * campaigns it needs the legislator rows (role/state/locality) — any candidate
 * ID without a supplied row is dropped (fail-closed).
 */
export function filterIdsInCampaignScope(
  candidateIds: string[],
  legislators: ScopeLegislator[],
  campaign: CampaignScope,
): string[] {
  if (campaign.target_legislator_ids && campaign.target_legislator_ids.length > 0) {
    const allowed = new Set(campaign.target_legislator_ids);
    return candidateIds.filter((id) => allowed.has(id));
  }
  const byId = new Map(legislators.map((l) => [l.id, l]));
  return candidateIds.filter((id) => {
    const leg = byId.get(id);
    return leg ? legislatorInCampaignScope(leg, campaign) : false;
  });
}
