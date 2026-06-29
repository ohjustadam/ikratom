import { describe, it, expect } from "vitest";
import {
  computeIntelVerdict,
  industriesFromDonor,
  pressureBandFor,
  type IntelSignals,
} from "@/lib/legislator-intel";
import { assessThreat } from "@/lib/legislator-threat-score";
import { buildMoneyConflict } from "@/lib/legislator-money-analysis";

const baseSignals: IntelSignals = {
  stance: "unknown",
  donorMatched: false,
  industries: {
    pharma: null,
    alcohol: null,
    tobacco: null,
    addictionTreatment: null,
    cannabis: null,
    gaming: null,
    hospitalHealth: null,
  },
  hasAntiSponsorship: false,
  hasProSponsorship: false,
  primaryAntiCount: 0,
  cosponsorCount: 0,
  isChairOfKratomRelevant: false,
  isMemberOfKratomRelevant: false,
  currentlyDecidingCount: 0,
  kratomAdjacentTradeCount: null,
};

describe("pressureBandFor", () => {
  it("classifies High at >= 60", () => {
    expect(pressureBandFor(60).label).toBe("High");
    expect(pressureBandFor(100).label).toBe("High");
  });
  it("classifies Moderate in [35, 60)", () => {
    expect(pressureBandFor(35).label).toBe("Moderate");
    expect(pressureBandFor(59).label).toBe("Moderate");
  });
  it("classifies Low below 35", () => {
    expect(pressureBandFor(34).label).toBe("Low");
    expect(pressureBandFor(0).label).toBe("Low");
  });
  it("carries a tone + note for the UI", () => {
    const b = pressureBandFor(70);
    expect(b.tone).toMatch(/text-/);
    expect(b.note.length).toBeGreaterThan(0);
  });
});

describe("industriesFromDonor", () => {
  it("returns all-null when there is no federal donor match (state legislator)", () => {
    const r = industriesFromDonor({ top_industries: [{ industry: "pharma_biotech", amount: 99_000 }] }, false);
    expect(r).toEqual({
      pharma: null,
      alcohol: null,
      tobacco: null,
      addictionTreatment: null,
      cannabis: null,
      gaming: null,
      hospitalHealth: null,
    });
  });

  it("returns 0 (not null) for matched donors with no rows in a bucket", () => {
    const r = industriesFromDonor(null, true);
    expect(r.pharma).toBe(0);
    expect(r.hospitalHealth).toBe(0);
  });

  it("maps the classify-donor-industries keys to the verdict buckets", () => {
    const r = industriesFromDonor(
      {
        top_industries: [
          { industry: "pharma_biotech", amount: 48_000 },
          { industry: "tobacco_nicotine", amount: 12_000 },
          { industry: "addiction_treatment", amount: 7_500 },
          { industry: "gaming_casino", amount: 3_000 },
          { industry: "unrelated_industry", amount: 500_000 },
        ],
      },
      true,
    );
    expect(r.pharma).toBe(48_000);
    expect(r.tobacco).toBe(12_000);
    expect(r.addictionTreatment).toBe(7_500);
    expect(r.gaming).toBe(3_000);
    expect(r.alcohol).toBe(0); // matched but no alcohol row
    expect(r.cannabis).toBe(0);
  });
});

describe("computeIntelVerdict", () => {
  it("passes the stance through unchanged", () => {
    expect(computeIntelVerdict({ ...baseSignals, stance: "hostile" }).stance).toBe("hostile");
  });

  it("derives pressureIndex as round(sqrt(threat × vulnerability)) and a matching band", () => {
    const v = computeIntelVerdict({
      ...baseSignals,
      stance: "neutral",
      isMemberOfKratomRelevant: true,
      currentlyDecidingCount: 2,
    });
    const expected = Math.round(Math.sqrt(v.threat.threat_score * v.threat.vulnerability_score));
    expect(v.pressureIndex).toBe(expected);
    expect(v.pressureBand).toEqual(pressureBandFor(v.pressureIndex));
  });

  it("flags an ALIGNED money conflict for a funded active opponent", () => {
    const v = computeIntelVerdict({
      ...baseSignals,
      stance: "hostile",
      donorMatched: true,
      industries: { ...baseSignals.industries, pharma: 48_000, alcohol: 0, tobacco: 0, addictionTreatment: 0, cannabis: 0, gaming: 0, hospitalHealth: 0 },
      hasAntiSponsorship: true,
      primaryAntiCount: 1,
    });
    expect(v.threat.tier).toBe("active_opponent");
    expect(v.moneyConflict?.level).toBe("aligned");
  });

  it("returns a null money conflict when there is no donor match and no trades", () => {
    const v = computeIntelVerdict({ ...baseSignals, stance: "hostile", hasAntiSponsorship: true, primaryAntiCount: 1 });
    expect(v.moneyConflict).toBeNull();
    // …but the threat tier is still computed from the structural signals.
    expect(v.threat.tier).toBe("active_opponent");
  });

  it("is a faithful wrapper: threat + money match calling the underlying scorers directly", () => {
    const signals: IntelSignals = {
      ...baseSignals,
      stance: "champion",
      donorMatched: true,
      industries: { ...baseSignals.industries, tobacco: 25_000, alcohol: 0, pharma: 0, addictionTreatment: 0, cannabis: 0, gaming: 0, hospitalHealth: 0 },
      hasProSponsorship: true,
      isMemberOfKratomRelevant: true,
      kratomAdjacentTradeCount: 0,
    };
    const v = computeIntelVerdict(signals);

    const threat = assessThreat({
      stance: signals.stance,
      has_anti_sponsorship: signals.hasAntiSponsorship,
      has_pro_sponsorship: signals.hasProSponsorship,
      primary_sponsorship_count: signals.primaryAntiCount,
      cosponsorship_count: signals.cosponsorCount,
      is_chair_of_kratom_relevant: signals.isChairOfKratomRelevant,
      is_member_of_kratom_relevant: signals.isMemberOfKratomRelevant,
      bills_in_their_committees: signals.currentlyDecidingCount,
      pharma_usd: signals.industries.pharma,
      alcohol_usd: signals.industries.alcohol,
      tobacco_usd: signals.industries.tobacco,
      addiction_treatment_usd: signals.industries.addictionTreatment,
      cannabis_usd: signals.industries.cannabis,
      gaming_usd: signals.industries.gaming,
      hospital_health_usd: signals.industries.hospitalHealth,
      kratom_adjacent_trade_count: signals.kratomAdjacentTradeCount,
    });
    expect(v.threat).toEqual(threat);

    const money = buildMoneyConflict({
      donorMatched: signals.donorMatched,
      industries: {
        pharma: signals.industries.pharma,
        tobacco: signals.industries.tobacco,
        alcohol: signals.industries.alcohol,
        addictionTreatment: signals.industries.addictionTreatment,
        hospitalHealth: signals.industries.hospitalHealth,
      },
      kratomAdjacentTrades: signals.kratomAdjacentTradeCount ?? 0,
      stance: signals.stance,
      threatTier: threat.tier,
    });
    expect(v.moneyConflict).toEqual(money);
    expect(v.moneyConflict?.level).toBe("ally");
  });
});
