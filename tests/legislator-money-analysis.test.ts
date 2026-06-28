import { describe, it, expect } from "vitest";
import { buildMoneyConflict, type MoneyConflictInput } from "@/lib/legislator-money-analysis";

const base: MoneyConflictInput = {
  donorMatched: true,
  industries: { pharma: 0, tobacco: 0, alcohol: 0, addictionTreatment: 0, hospitalHealth: 0 },
  kratomAdjacentTrades: 0,
  stance: "unknown",
  threatTier: "low_priority",
};

describe("buildMoneyConflict", () => {
  it("returns null for a state legislator (no donor match, no trades)", () => {
    expect(buildMoneyConflict({ ...base, donorMatched: false })).toBeNull();
  });

  it("flags an ALIGNED conflict: restriction-aligned money + hostile posture", () => {
    const r = buildMoneyConflict({
      ...base,
      industries: { ...base.industries, pharma: 48_000 },
      threatTier: "active_opponent",
      stance: "hostile",
    });
    expect(r?.level).toBe("aligned");
    expect(r?.posture).toBe("restrict");
    expect(r?.restrictionAlignedUsd).toBe(48_000);
    expect(r?.topIndustries[0].key).toBe("pharma");
  });

  it("flags an ALLY: restriction-aligned money but pro-kratom posture", () => {
    const r = buildMoneyConflict({
      ...base,
      industries: { ...base.industries, tobacco: 25_000 },
      threatTier: "champion",
      stance: "champion",
    });
    expect(r?.level).toBe("ally");
    expect(r?.posture).toBe("protect");
  });

  it("flags WATCH: money present, posture unclear", () => {
    const r = buildMoneyConflict({
      ...base,
      industries: { ...base.industries, alcohol: 30_000 },
      threatTier: "flippable_target",
    });
    expect(r?.level).toBe("watch");
    expect(r?.posture).toBe("unclear");
  });

  it("is CLEAN when money is below the material floor and no trades", () => {
    const r = buildMoneyConflict({ ...base, industries: { ...base.industries, pharma: 500 } });
    expect(r?.level).toBe("clean");
    expect(r?.restrictionAlignedUsd).toBe(500);
  });

  it("surfaces a trades-only signal even without a donor match", () => {
    const r = buildMoneyConflict({ ...base, donorMatched: false, kratomAdjacentTrades: 3, threatTier: "hostile_decision_maker" });
    expect(r).not.toBeNull();
    expect(r?.level).toBe("aligned");
    expect(r?.kratomAdjacentTrades).toBe(3);
  });

  it("sums + ranks multiple restriction-aligned industries", () => {
    const r = buildMoneyConflict({
      ...base,
      industries: { pharma: 20_000, tobacco: 5_000, alcohol: 40_000, addictionTreatment: 0, hospitalHealth: 0 },
      threatTier: "active_opponent",
    });
    expect(r?.restrictionAlignedUsd).toBe(65_000);
    expect(r?.topIndustries[0].key).toBe("alcohol"); // highest first
  });
});
