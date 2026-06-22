// src/lib/campaign-priority.ts
// Composite "relevance & importance" score for ranking campaigns in the admin
// triage view. Raw action count alone is a poor rank: only ~7 of 152 campaigns
// have ANY actions (a state with no users yet can still host a critical fight),
// so 145 would tie at 0. This blends recent engagement with urgency + whether the
// underlying fight is still live, so important-but-quiet campaigns surface and
// dormant ones sink — WITHOUT deleting anything (low score ≠ removed).

export type PrioritySignals = {
  actions14d: number;      // engagement velocity — what's hot now
  actionsAll: number;      // total reach
  severity: string | null; // linked alert severity: critical | alert | watch | routine | null
  hasBill: boolean;        // linked to a bill at all
  billConcluded: boolean;  // linked bill is terminal (dead/enacted/inactive) — fight is over
  quiet60: boolean;        // zero actions in the last 60 days
  ageDays: number;         // days since created
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const SEV: Record<string, number> = { critical: 1, alert: 0.7, watch: 0.4, routine: 0.15 };

/**
 * 0–100 priority score + a coarse tier. Weights (sum to 1 before the staleness
 * factor): velocity .40, reach .20, urgency .25, live-fight .15. A campaign that
 * is >60 days old AND has had no action in 60 days is halved (sinks, never
 * removed) — but a quiet NEW campaign or a quiet campaign on a live bill is not
 * penalised, so "no users in that area yet" doesn't bury a real fight.
 */
export function computePriority(s: PrioritySignals): { score: number; tier: "high" | "medium" | "low" } {
  const velocity = clamp01(Math.log1p(Math.max(0, s.actions14d)) / Math.log1p(20)); // ~20 actions/14d = max
  const reach = clamp01(Math.log1p(Math.max(0, s.actionsAll)) / Math.log1p(200));
  const urgency = s.severity ? (SEV[s.severity] ?? 0.15) : 0.15;
  const liveFight = s.billConcluded ? 0 : s.hasBill ? 1 : 0.4; // live bill = top, concluded = 0, no-bill = neutral
  const base = 0.40 * velocity + 0.20 * reach + 0.25 * urgency + 0.15 * liveFight;
  const staleFactor = s.quiet60 && s.ageDays > 60 ? 0.5 : 1;
  const score = Math.round(100 * base * staleFactor);
  const tier = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { score, tier };
}
