import { describe, it, expect } from "vitest";
import { computePriority } from "@/lib/campaign-priority";

const base = { actions14d: 0, actionsAll: 0, severity: null, hasBill: false, billConcluded: false, quiet60: true, ageDays: 5 };

describe("computePriority", () => {
  it("ranks a hot, critical, live-bill campaign high", () => {
    const r = computePriority({ ...base, actions14d: 20, actionsAll: 150, severity: "critical", hasBill: true, quiet60: false });
    expect(r.tier).toBe("high");
    expect(r.score).toBeGreaterThan(70);
  });

  it("does NOT bury a quiet NEW campaign (no users in that area yet)", () => {
    // zero actions but recent + on a live bill → staleness factor must NOT apply
    const fresh = computePriority({ ...base, severity: "alert", hasBill: true, quiet60: true, ageDays: 10 });
    const stale = computePriority({ ...base, severity: "alert", hasBill: true, quiet60: true, ageDays: 200 });
    expect(stale.score).toBeLessThan(fresh.score); // old+quiet is halved; fresh is not
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("sinks (does not delete) an old, quiet, no-bill campaign", () => {
    const r = computePriority({ ...base, ageDays: 300, quiet60: true });
    expect(r.tier).toBe("low");
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("scores a concluded-bill fight below an identical live one", () => {
    const live = computePriority({ ...base, severity: "watch", hasBill: true, billConcluded: false, quiet60: false });
    const over = computePriority({ ...base, severity: "watch", hasBill: true, billConcluded: true, quiet60: false });
    expect(over.score).toBeLessThan(live.score);
  });

  it("hot > quiet-but-live > quiet-and-stale", () => {
    const hot = computePriority({ ...base, actions14d: 15, severity: "alert", hasBill: true, quiet60: false }).score;
    const quietLive = computePriority({ ...base, severity: "alert", hasBill: true, quiet60: true, ageDays: 10 }).score;
    const quietStale = computePriority({ ...base, hasBill: false, quiet60: true, ageDays: 200 }).score;
    expect(hot).toBeGreaterThan(quietLive);
    expect(quietLive).toBeGreaterThan(quietStale);
  });
});
