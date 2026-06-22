import { describe, expect, it } from "vitest";
import {
  legislatorInCampaignScope,
  filterIdsInCampaignScope,
  type CampaignScope,
  type ScopeLegislator,
} from "../scope";

const leg = (over: Partial<ScopeLegislator> & { id: string }): ScopeLegislator => ({
  role: "state_senate",
  state: "OK",
  locality: null,
  ...over,
});

describe("legislatorInCampaignScope", () => {
  describe("explicit-target campaigns", () => {
    const campaign: CampaignScope = {
      target_legislator_ids: ["a", "b"],
      target_roles: ["state_senate"],
      state: "OK",
      target_locality: null,
    };
    it("accepts an id in the curated set", () => {
      expect(legislatorInCampaignScope(leg({ id: "a" }), campaign)).toBe(true);
    });
    it("rejects an id NOT in the curated set even if role/state match", () => {
      expect(legislatorInCampaignScope(leg({ id: "z", role: "state_senate", state: "OK" }), campaign)).toBe(false);
    });
    it("the curated set overrides role/state — an off-role id in the set is allowed", () => {
      expect(legislatorInCampaignScope(leg({ id: "b", role: "mayor", state: "CA" }), campaign)).toBe(true);
    });
  });

  describe("role-based state campaigns", () => {
    const campaign: CampaignScope = {
      target_legislator_ids: null,
      target_roles: ["state_senate", "state_house"],
      state: "OK",
      target_locality: null,
    };
    it("accepts matching role + matching state", () => {
      expect(legislatorInCampaignScope(leg({ id: "1", role: "state_house", state: "OK" }), campaign)).toBe(true);
    });
    it("rejects matching role but WRONG state (out-of-state own reps)", () => {
      expect(legislatorInCampaignScope(leg({ id: "2", role: "state_senate", state: "TX" }), campaign)).toBe(false);
    });
    it("rejects a non-targeted role", () => {
      expect(legislatorInCampaignScope(leg({ id: "3", role: "us_senate", state: "OK" }), campaign)).toBe(false);
    });
    it("treats empty target_legislator_ids array as role-based (not explicit)", () => {
      const c: CampaignScope = { ...campaign, target_legislator_ids: [] };
      expect(legislatorInCampaignScope(leg({ id: "1", role: "state_senate", state: "OK" }), c)).toBe(true);
      expect(legislatorInCampaignScope(leg({ id: "2", role: "state_senate", state: "TX" }), c)).toBe(false);
    });
  });

  describe("role-based local campaigns", () => {
    const campaign: CampaignScope = {
      target_legislator_ids: null,
      target_roles: ["mayor", "city_council"],
      state: "TX",
      target_locality: "Austin, TX",
    };
    it("accepts matching role + matching locality", () => {
      expect(legislatorInCampaignScope(leg({ id: "1", role: "mayor", state: "TX", locality: "Austin, TX" }), campaign)).toBe(true);
    });
    it("matches locality case-insensitively", () => {
      expect(legislatorInCampaignScope(leg({ id: "1", role: "mayor", state: "TX", locality: "austin, tx" }), campaign)).toBe(true);
    });
    it("rejects a same-state official in a DIFFERENT locality (the wrong-city bug)", () => {
      expect(legislatorInCampaignScope(leg({ id: "2", role: "mayor", state: "TX", locality: "Dallas, TX" }), campaign)).toBe(false);
    });
    it("rejects when locality is missing", () => {
      expect(legislatorInCampaignScope(leg({ id: "3", role: "mayor", state: "TX", locality: null }), campaign)).toBe(false);
    });
  });

  describe("federal campaigns (no state, no locality)", () => {
    const campaign: CampaignScope = {
      target_legislator_ids: null,
      target_roles: ["us_senate", "us_house"],
      state: null,
      target_locality: null,
    };
    it("accepts a matching role in ANY state (each user's own delegation)", () => {
      expect(legislatorInCampaignScope(leg({ id: "1", role: "us_senate", state: "OK" }), campaign)).toBe(true);
      expect(legislatorInCampaignScope(leg({ id: "2", role: "us_house", state: "CA" }), campaign)).toBe(true);
    });
    it("rejects a non-targeted role", () => {
      expect(legislatorInCampaignScope(leg({ id: "3", role: "state_senate", state: "OK" }), campaign)).toBe(false);
    });
  });

  it("fails closed when target_roles is null and there are no explicit ids", () => {
    const campaign: CampaignScope = { target_legislator_ids: null, target_roles: null, state: "OK", target_locality: null };
    expect(legislatorInCampaignScope(leg({ id: "1", role: "state_senate", state: "OK" }), campaign)).toBe(false);
  });
});

describe("filterIdsInCampaignScope", () => {
  it("explicit: returns only ids in the curated set (no rows needed)", () => {
    const campaign: CampaignScope = { target_legislator_ids: ["a", "b"], target_roles: [], state: null, target_locality: null };
    expect(filterIdsInCampaignScope(["a", "x", "b"], [], campaign)).toEqual(["a", "b"]);
  });

  it("role-based state: keeps in-state targeted roles, drops others", () => {
    const campaign: CampaignScope = { target_legislator_ids: null, target_roles: ["state_senate"], state: "OK", target_locality: null };
    const rows = [
      leg({ id: "ok1", role: "state_senate", state: "OK" }),
      leg({ id: "tx1", role: "state_senate", state: "TX" }),
      leg({ id: "ok2", role: "us_senate", state: "OK" }),
    ];
    expect(filterIdsInCampaignScope(["ok1", "tx1", "ok2"], rows, campaign)).toEqual(["ok1"]);
  });

  it("drops candidate ids that have no supplied row (fail-closed)", () => {
    const campaign: CampaignScope = { target_legislator_ids: null, target_roles: ["state_senate"], state: "OK", target_locality: null };
    const rows = [leg({ id: "ok1", role: "state_senate", state: "OK" })];
    expect(filterIdsInCampaignScope(["ok1", "ghost"], rows, campaign)).toEqual(["ok1"]);
  });
});
