import { describe, expect, it } from "vitest";
import { buildActionPlan, type LeverageSignal, type Stance } from "../legislator-action-plan";

// Build a baseline LeverageSignal where everything is false/zero.
// Tests override specific fields per case.
function emptySig(): LeverageSignal {
  return {
    isChairOfKratomRelevant: false,
    isMemberOfKratomRelevant: false,
    bills_in_their_committees_count: 0,
    primary_sponsorships: 0,
    cosponsorships: 0,
    has_anti_sponsorship: false,
    has_pro_sponsorship: false,
    pharma_donations_usd: null,
    alcohol_donations_usd: null,
    tobacco_donations_usd: null,
    is_user_rep: false,
  };
}

describe("buildActionPlan — urgency rules", () => {
  it("sets HIGH urgency when the legislator has anti-sponsorship and isn't a champion/sympathetic", () => {
    const plan = buildActionPlan("neutral", { ...emptySig(), has_anti_sponsorship: true });
    expect(plan.urgency).toBe("high");
  });

  it("sets HIGH urgency when a hostile legislator chairs a relevant committee", () => {
    const plan = buildActionPlan("hostile", { ...emptySig(), isChairOfKratomRelevant: true });
    expect(plan.urgency).toBe("high");
  });

  it("sets HIGH urgency when bills are in the legislator's committees right now", () => {
    const plan = buildActionPlan("neutral", { ...emptySig(), bills_in_their_committees_count: 3 });
    expect(plan.urgency).toBe("high");
  });

  it("does NOT bump anti-sponsorship to HIGH when the stance is champion", () => {
    const plan = buildActionPlan("champion", { ...emptySig(), has_anti_sponsorship: true });
    expect(plan.urgency).not.toBe("high");
  });

  it("sets MEDIUM urgency for hostile/sympathetic/champion absent the high triggers", () => {
    expect(buildActionPlan("hostile", emptySig()).urgency).toBe("medium");
    expect(buildActionPlan("sympathetic", emptySig()).urgency).toBe("medium");
    expect(buildActionPlan("champion", emptySig()).urgency).toBe("medium");
  });

  it("sets LOW urgency for unknown/neutral absent the high triggers", () => {
    expect(buildActionPlan("unknown", emptySig()).urgency).toBe("low");
    expect(buildActionPlan("neutral", emptySig()).urgency).toBe("low");
  });
});

describe("buildActionPlan — stance branches", () => {
  it("recommends EMAIL as primary for champions", () => {
    const plan = buildActionPlan("champion", emptySig());
    expect(plan.primary_channel).toBe("email");
    expect(plan.posture).toMatch(/champion/i);
  });

  it("acknowledges a pro-sponsorship champion's primary bill in the posture", () => {
    const plan = buildActionPlan("champion", { ...emptySig(), has_pro_sponsorship: true });
    expect(plan.posture).toContain("primary sponsor");
  });

  it("recommends EMAIL as primary for sympathetic", () => {
    const plan = buildActionPlan("sympathetic", emptySig());
    expect(plan.primary_channel).toBe("email");
  });

  it("mentions cosponsorship count in sympathetic posture when present", () => {
    const plan = buildActionPlan("sympathetic", { ...emptySig(), cosponsorships: 2 });
    expect(plan.posture).toContain("2 cosponsorships");
  });

  it("uses correct grammar for 1 cosponsorship", () => {
    const plan = buildActionPlan("sympathetic", { ...emptySig(), cosponsorships: 1 });
    expect(plan.posture).toContain("1 cosponsorship ");
    expect(plan.posture).not.toContain("1 cosponsorships");
  });

  it("recommends LETTER as primary for neutral (no public signal yet)", () => {
    const plan = buildActionPlan("neutral", emptySig());
    expect(plan.primary_channel).toBe("letter");
  });

  it("recommends CALL as primary for hostile (volume matters)", () => {
    const plan = buildActionPlan("hostile", emptySig());
    expect(plan.primary_channel).toBe("call");
  });

  it("mentions sponsorship count in hostile posture when has_anti_sponsorship", () => {
    const plan = buildActionPlan("hostile", { ...emptySig(), has_anti_sponsorship: true, primary_sponsorships: 3 });
    expect(plan.posture).toContain("3 restrictive bills");
  });

  it("recommends LETTER as primary for unknown (probe phase)", () => {
    const plan = buildActionPlan("unknown", emptySig());
    expect(plan.primary_channel).toBe("letter");
  });
});

describe("buildActionPlan — leverage flags", () => {
  it("emits 'Your representative' flag when is_user_rep", () => {
    const plan = buildActionPlan("neutral", { ...emptySig(), is_user_rep: true });
    expect(plan.leverage_flags.some((f) => f.label === "Your representative")).toBe(true);
  });

  it("does NOT emit 'Your representative' when not the user's rep", () => {
    const plan = buildActionPlan("neutral", emptySig());
    expect(plan.leverage_flags.some((f) => f.label === "Your representative")).toBe(false);
  });

  it("emits 'Deciding N bills right now' when bills in committees", () => {
    const plan = buildActionPlan("neutral", { ...emptySig(), bills_in_their_committees_count: 4 });
    const f = plan.leverage_flags.find((f) => f.label.includes("Deciding"));
    expect(f).toBeDefined();
    expect(f?.label).toContain("4 bills");
  });

  it("colors the 'Deciding' flag ALARM when stance is hostile", () => {
    const plan = buildActionPlan("hostile", { ...emptySig(), bills_in_their_committees_count: 1 });
    const f = plan.leverage_flags.find((f) => f.label.includes("Deciding"));
    expect(f?.severity).toBe("alarm");
  });

  it("colors the 'Deciding' flag WIN when stance is champion", () => {
    const plan = buildActionPlan("champion", { ...emptySig(), bills_in_their_committees_count: 1 });
    const f = plan.leverage_flags.find((f) => f.label.includes("Deciding"));
    expect(f?.severity).toBe("win");
  });
});

describe("buildActionPlan — invariants across all stances", () => {
  const stances: Stance[] = ["champion", "sympathetic", "neutral", "hostile", "unknown"];

  it.each(stances)("always provides talking_points (>= 2 items) for %s", (stance) => {
    const plan = buildActionPlan(stance, emptySig());
    expect(plan.talking_points.length).toBeGreaterThanOrEqual(2);
  });

  it.each(stances)("always provides watch_outs (>= 1 item) for %s", (stance) => {
    const plan = buildActionPlan(stance, emptySig());
    expect(plan.watch_outs.length).toBeGreaterThanOrEqual(1);
  });

  it.each(stances)("always provides a non-empty posture string for %s", (stance) => {
    const plan = buildActionPlan(stance, emptySig());
    expect(plan.posture.length).toBeGreaterThan(20);
  });

  it.each(stances)("always provides at least one alt channel for %s", (stance) => {
    const plan = buildActionPlan(stance, emptySig());
    expect(plan.alt_channels.length).toBeGreaterThanOrEqual(1);
  });
});
