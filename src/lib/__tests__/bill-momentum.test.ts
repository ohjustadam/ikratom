import { describe, expect, it } from "vitest";
import { computeBillMomentum } from "../bill-momentum";

/**
 * Locks the heuristic's behavior so v2 (classifier replacement) can
 * be regression-tested. Tests are intentionally loose on exact score
 * values — they pin LABELS + relative ordering, not magic numbers.
 */

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

describe("computeBillMomentum", () => {
  it("flags a freshly-acted, multi-sponsor, multi-cluster bill as advancing-fast", () => {
    const m = computeBillMomentum({
      last_action_at: daysAgoIso(3),
      status: "passed_committee",
      current_committee_name: "House Health",
      sponsor_count: 12,
      cluster_count: 2,
      recent_news_mentions: 6,
      active: true,
    });
    expect(m.label).toBe("advancing-fast");
    expect(m.score).toBeGreaterThanOrEqual(75);
  });

  it("flags an inactive bill as dead regardless of score", () => {
    const m = computeBillMomentum({
      last_action_at: daysAgoIso(1),
      status: "introduced",
      current_committee_name: "Senate Judiciary",
      sponsor_count: 20,
      cluster_count: 2,
      recent_news_mentions: 10,
      active: false,
    });
    expect(m.label).toBe("dead");
    expect(m.score).toBeLessThanOrEqual(5);
  });

  it("flags an explicitly-dead status as dead", () => {
    const m = computeBillMomentum({
      last_action_at: daysAgoIso(20),
      status: "dead",
      current_committee_name: null,
      sponsor_count: 3,
      cluster_count: 0,
      recent_news_mentions: 0,
      active: true,
    });
    expect(m.label).toBe("dead");
  });

  it("flags a stale solo bill with no cluster as likely-stalled", () => {
    const m = computeBillMomentum({
      last_action_at: daysAgoIso(120),
      status: "introduced",
      current_committee_name: null,
      sponsor_count: 1,
      cluster_count: 0,
      recent_news_mentions: 0,
      active: true,
    });
    expect(["likely-stalled", "dead"]).toContain(m.label);
    expect(m.score).toBeLessThan(40);
  });

  it("ranks an active fresh bill higher than a stale solo bill", () => {
    const fresh = computeBillMomentum({
      last_action_at: daysAgoIso(2),
      status: "passed_committee",
      current_committee_name: "Senate Health",
      sponsor_count: 8,
      cluster_count: 1,
      recent_news_mentions: 3,
      active: true,
    });
    const stale = computeBillMomentum({
      last_action_at: daysAgoIso(150),
      status: "introduced",
      current_committee_name: null,
      sponsor_count: 1,
      cluster_count: 0,
      recent_news_mentions: 0,
      active: true,
    });
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("score is clamped to 0..100", () => {
    const lo = computeBillMomentum({
      last_action_at: daysAgoIso(500),
      status: "dead",
      current_committee_name: null,
      sponsor_count: 0,
      cluster_count: 0,
      recent_news_mentions: 0,
      active: false,
    });
    expect(lo.score).toBeGreaterThanOrEqual(0);

    const hi = computeBillMomentum({
      last_action_at: daysAgoIso(0),
      status: "enacted",
      current_committee_name: "Whatever",
      sponsor_count: 50,
      cluster_count: 3,
      recent_news_mentions: 30,
      active: true,
    });
    expect(hi.score).toBeLessThanOrEqual(100);
  });

  it("populates signals for an active bill", () => {
    const m = computeBillMomentum({
      last_action_at: daysAgoIso(5),
      status: "passed_committee",
      current_committee_name: "House Health",
      sponsor_count: 8,
      cluster_count: 1,
      recent_news_mentions: 2,
      active: true,
    });
    expect(m.signals.length).toBeGreaterThan(0);
  });

  it("handles a bill with no last_action_at gracefully", () => {
    const m = computeBillMomentum({
      last_action_at: null,
      status: "introduced",
      current_committee_name: null,
      sponsor_count: 1,
      cluster_count: 0,
      recent_news_mentions: 0,
      active: true,
    });
    expect(typeof m.score).toBe("number");
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(100);
  });
});
