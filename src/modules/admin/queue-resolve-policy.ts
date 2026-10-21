import type { PlanItem, ProposedAction } from "./queue-resolve-types";

/**
 * Full-auto policy: turn a proposal into a final action. Pure, so it is tested
 * directly (tests/moderation-gate.test.ts).
 *
 * Changed 2026-10-21 (owner: auto-resolve "doesn't always be thorough before
 * rejecting one that indeed was a new and fresh campaign"). It used to reject
 * everything the AI was unsure about, and every low-confidence approve, so the
 * queue always ended empty. A wrong reject buries a real call to action, so now:
 * - duplicates supersede; a linked bill that is dead/enacted rejects (both
 *   deterministic, high confidence);
 * - an AI reject applies only at HIGH confidence;
 * - an AI approve applies unless confidence is low (it notifies users);
 * - everything else (unsure, low confidence, past the fact-check cap) stays in
 *   the queue for a person.
 */
export function autoDecision(p: PlanItem): ProposedAction {
  if (p.action === "supersede") return "supersede";
  if (p.action === "reject") {
    if (p.source === "duplicate" || p.source === "bill-status") return "reject";
    return p.confidence === "high" ? "reject" : "keep";
  }
  if (p.action === "approve") return p.confidence === "low" ? "keep" : "approve";
  return "keep";
}
