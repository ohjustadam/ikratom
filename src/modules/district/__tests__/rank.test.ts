import { describe, it, expect } from "vitest";
import { rankActions, type RankableCampaign, type RankableBill } from "../rank";

const NOW = Date.UTC(2026, 5, 4); // fixed clock so the test is deterministic
const recent = new Date(NOW - 5 * 86_400_000).toISOString();
const old = new Date(NOW - 200 * 86_400_000).toISOString();

function campaign(over: Partial<RankableCampaign>): RankableCampaign {
  return {
    id: over.id ?? "c1",
    slug: over.slug ?? "c1",
    title: over.title ?? "Campaign",
    blurb: null,
    state: over.state ?? "OK",
    bill_id: over.bill_id ?? null,
    target_locality: over.target_locality ?? null,
    created_at: over.created_at ?? recent,
  };
}

describe("rankActions", () => {
  it("ranks a locality-matched campaign above a state-only one", () => {
    const camps = [
      campaign({ id: "state", target_locality: null }),
      campaign({ id: "local", target_locality: "Tulsa, OK" }),
    ];
    const ranked = rankActions(camps, new Map(), {
      userState: "OK",
      userLocality: "Tulsa, OK",
      now: NOW,
    });
    expect(ranked[0].id).toBe("local");
    expect(ranked[0].reasons).toContain("In your city/county");
  });

  it("a hostile, advancing, recently-moved bill outranks a plain in-state campaign", () => {
    const camps = [
      campaign({ id: "plain", bill_id: null }),
      campaign({ id: "urgent", bill_id: "b1" }),
    ];
    const bills = new Map<string, RankableBill>([
      ["b1", { id: "b1", status: "committee", kratom_relevance: "anti", last_action_at: recent, scope: "state" }],
    ]);
    const ranked = rankActions(camps, bills, { userState: "OK", userLocality: null, now: NOW });
    expect(ranked[0].id).toBe("urgent");
    expect(ranked[0].reasons).toEqual(expect.arrayContaining(["Hostile bill", "Advancing now", "Moved in last 30 days"]));
  });

  it("a dormant bill (old last action) does not get the recency bonus", () => {
    const camps = [campaign({ id: "dormant", bill_id: "b2", created_at: old })];
    const bills = new Map<string, RankableBill>([
      ["b2", { id: "b2", status: "introduced", kratom_relevance: "anti", last_action_at: old, scope: "state" }],
    ]);
    const ranked = rankActions(camps, bills, { userState: "OK", userLocality: null, now: NOW });
    expect(ranked[0].reasons).not.toContain("Moved in last 30 days");
    // in-state (40) + hostile (20) only
    expect(ranked[0].score).toBeGreaterThanOrEqual(60);
    expect(ranked[0].score).toBeLessThan(70);
  });

  it("returns [] for no campaigns and is deterministic", () => {
    expect(rankActions([], new Map(), { userState: "OK", userLocality: null, now: NOW })).toEqual([]);
  });
});
