import { describe, it, expect } from "vitest";
import {
  levelForArea,
  normalizeFiveCallsRep,
  fiveCallsEnabled,
  fetchFiveCallsReps,
} from "../scripts/lib/5calls-officials.mjs";

/**
 * 5 Calls officials client (build #9, state/federal layer). The network call is
 * untested by design (no token in CI), but the pure normalizer + the dormant
 * no-op guard ARE pinned so the client can't silently misclassify or fire a
 * request without a token.
 */
describe("5calls-officials: area → level bucketing", () => {
  it("maps federal / state-executive / state / other", () => {
    expect(levelForArea("US House")).toBe("federal");
    expect(levelForArea("US Senate")).toBe("federal");
    expect(levelForArea("Governor")).toBe("state_executive");
    expect(levelForArea("AttorneyGeneral")).toBe("state_executive");
    expect(levelForArea("SecretaryOfState")).toBe("state_executive");
    expect(levelForArea("StateUpper")).toBe("state");
    expect(levelForArea("StateLower")).toBe("state");
    expect(levelForArea("Mayor")).toBe("other");
    expect(levelForArea(null)).toBe("other");
  });
});

describe("5calls-officials: normalizeFiveCallsRep", () => {
  it("normalizes a full rep into our officials shape", () => {
    const rep = {
      id: "abc",
      name: "Jane Doe",
      phone: "555-1212",
      url: "https://example.gov",
      photoURL: "https://example.gov/p.jpg",
      party: "Independent",
      area: "US Senate",
    };
    expect(normalizeFiveCallsRep(rep)).toEqual({
      full_name: "Jane Doe",
      phone: "555-1212",
      website: "https://example.gov",
      photo: "https://example.gov/p.jpg",
      party: "Independent",
      area: "US Senate",
      level: "federal",
      five_calls_id: "abc",
    });
  });
  it("returns null for junk and tolerates missing fields", () => {
    expect(normalizeFiveCallsRep(null)).toBeNull();
    expect(normalizeFiveCallsRep(undefined)).toBeNull();
    expect(normalizeFiveCallsRep({})).toEqual({
      full_name: null, phone: null, website: null, photo: null,
      party: null, area: null, level: "other", five_calls_id: null,
    });
  });
});

describe("5calls-officials: dormant without a token", () => {
  it("no-ops (never fetches) when FIVECALLS_TOKEN is unset", async () => {
    // CI has no token → the client must short-circuit before any network call.
    if (!fiveCallsEnabled()) {
      const res = await fetchFiveCallsReps("90210");
      expect(res).toEqual({ ok: false, disabled: true, reason: "FIVECALLS_TOKEN not set" });
    } else {
      // Token present (local run with a real token) — just assert it reports enabled.
      expect(fiveCallsEnabled()).toBe(true);
    }
  });
  it("rejects an empty location even when enabled-path is taken", async () => {
    const res = await fetchFiveCallsReps("");
    // Without a token this is the disabled branch; with a token it's the no-location branch.
    expect(res.ok).toBe(false);
  });
});
