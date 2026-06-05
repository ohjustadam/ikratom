/**
 * Pure urgency ranking for the "My District" action hub.
 *
 * The codebase has no stored composite-urgency score for campaigns (the
 * threat-tier system scores legislators, not campaigns). So we compute a
 * lightweight, explainable score here to surface the SINGLE highest-priority
 * action for a user. Signals, strongest first:
 *   - in the user's locality (local fights are the most concrete + winnable)
 *   - in the user's state
 *   - linked to a hostile (anti) bill
 *   - that bill is advancing (committee / passed a chamber)
 *   - that bill moved in the last 30 days (live, not dormant)
 * A small recency term breaks ties without ever outweighing a real signal.
 *
 * Pure + deterministic (caller passes `now`), so it's unit-testable and the
 * `reasons` array doubles as the user-facing "why this is #1" explanation.
 */

export type RankableCampaign = {
  id: string;
  slug: string | null;
  title: string;
  blurb: string | null;
  state: string | null;
  bill_id: string | null;
  target_locality: string | null;
  created_at: string;
};

export type RankableBill = {
  id: string;
  status: string | null;
  kratom_relevance: string | null;
  last_action_at: string | null;
  scope: string | null;
};

export type RankedAction = RankableCampaign & {
  score: number;
  reasons: string[];
  bill: RankableBill | null;
};

const ADVANCED = new Set(["committee", "passed_chamber"]);
const THIRTY_DAYS = 30 * 86_400_000;

export function rankActions(
  campaigns: RankableCampaign[],
  billsById: Map<string, RankableBill>,
  opts: { userState: string | null; userLocality: string | null; now: number },
): RankedAction[] {
  const userLoc = opts.userLocality?.toUpperCase() ?? null;
  return campaigns
    .map((c) => {
      const bill = c.bill_id ? billsById.get(c.bill_id) ?? null : null;
      const reasons: string[] = [];
      let score = 0;

      if (userLoc && c.target_locality && c.target_locality.toUpperCase() === userLoc) {
        score += 100;
        reasons.push("In your city/county");
      } else if (opts.userState && c.state === opts.userState) {
        score += 40;
        reasons.push("In your state");
      } else if (!c.state) {
        score += 10;
        reasons.push("Federal");
      }

      if (bill) {
        if (bill.kratom_relevance === "anti") {
          score += 20;
          reasons.push("Hostile bill");
        }
        if (bill.status && ADVANCED.has(bill.status)) {
          score += 30;
          reasons.push("Advancing now");
        }
        if (bill.last_action_at && opts.now - Date.parse(bill.last_action_at) < THIRTY_DAYS) {
          score += 30;
          reasons.push("Moved in last 30 days");
        }
      }

      // Recency micro-tiebreak: up to +5 for a brand-new campaign, decaying
      // over ~5 months. Bounded so it never overrides a real urgency signal.
      const ageDays = (opts.now - Date.parse(c.created_at)) / 86_400_000;
      if (Number.isFinite(ageDays)) score += Math.max(0, 5 - ageDays / 30);

      return { ...c, score, reasons, bill };
    })
    .sort((a, b) => b.score - a.score);
}
