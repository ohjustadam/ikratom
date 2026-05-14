/**
 * Tests for src/lib/bill-committee.ts — the regex parser that
 * extracts committee names from bill_actions.description strings and
 * the loose matcher that cross-references those names against
 * legislator_committees.committee_name rows (which come from a
 * different source and have slight schema drift).
 *
 * The strings below are real samples pulled from production bill_actions
 * during the data audit for PR #223. Keeping them as fixtures here
 * guards against regressions in the regex if/when we tweak it.
 */

import { describe, it, expect } from "vitest";
import {
  parseCommitteeFromAction,
  committeesMatch,
  normalizeCommitteeName,
} from "@/lib/bill-committee";

describe("parseCommitteeFromAction", () => {
  it("extracts a simple Senate Health Committee referral", () => {
    const r = parseCommitteeFromAction("Referred to Senate Health Committee");
    expect(r?.name).toBe("Senate Health Committee");
    expect(r?.chamber).toBe("senate");
  });

  it("extracts a House committee from 'Action deferred in...' wording", () => {
    const r = parseCommitteeFromAction(
      "Action deferred in House Judiciary Committee to 3/25/2026",
    );
    expect(r?.name).toBe("House Judiciary Committee");
    expect(r?.chamber).toBe("house");
  });

  it("extracts an Assembly committee and tags chamber=house", () => {
    const r = parseCommitteeFromAction(
      "To be heard in Assembly Codes Committee on 4/8/2026",
    );
    expect(r?.name).toBe("Assembly Codes Committee");
    expect(r?.chamber).toBe("house");
  });

  it("extracts a Joint committee", () => {
    const r = parseCommitteeFromAction(
      "Bill placed before Joint Health and Welfare Committee",
    );
    expect(r?.name).toBe("Joint Health and Welfare Committee");
    expect(r?.chamber).toBe("joint");
  });

  it("handles multi-clause descriptions, returning the FIRST committee mentioned", () => {
    // Real-world bill_action: "House Recommended for passage, refer to
    // Senate Finance, Ways, and Means Committee"
    const r = parseCommitteeFromAction(
      "House Recommended for passage, refer to Senate Finance, Ways, and Means Committee",
    );
    expect(r?.name).toBe("Senate Finance, Ways, and Means Committee");
    expect(r?.chamber).toBe("senate");
  });

  it("returns null when no committee mentioned", () => {
    expect(parseCommitteeFromAction("Signed by the Governor")).toBeNull();
    expect(parseCommitteeFromAction("Read second time and laid over")).toBeNull();
  });

  it("returns null for empty / null / undefined input", () => {
    expect(parseCommitteeFromAction(null)).toBeNull();
    expect(parseCommitteeFromAction(undefined)).toBeNull();
    expect(parseCommitteeFromAction("")).toBeNull();
  });

  it("rejects matches longer than 80 chars (defensive against runaway sentences)", () => {
    // The inner non-greedy group caps at 80 chars between
    // chamber-word and trailing "Committee". A description whose
    // filler exceeds that window won't match anywhere — regex falls
    // through and returns null.
    const filler = "x".repeat(95);
    const huge = `Referred to Senate ${filler} Committee`;
    expect(parseCommitteeFromAction(huge)).toBeNull();
  });

  it("strips trailing whitespace from the captured name", () => {
    const r = parseCommitteeFromAction(
      "Referred to Senate Health   Committee",
    );
    expect(r?.name.endsWith("Committee")).toBe(true);
    expect(r?.name.startsWith(" ")).toBe(false);
  });

  // Form B fixtures — `<Chamber> Committee on <Body>`. This shape is
  // common in OpenStates last_action snapshots and matters because
  // most of our 467 active bills come through that path, not LegiScan.

  it("Form B: extracts 'Senate Committee on Healthcare' and canonicalizes to Form A", () => {
    const r = parseCommitteeFromAction(
      "Read for the first time and referred to the Senate Committee on Healthcare",
    );
    expect(r?.name).toBe("Senate Healthcare Committee");
    expect(r?.chamber).toBe("senate");
  });

  it("Form B: extracts 'House Committee on Public Health'", () => {
    const r = parseCommitteeFromAction(
      "Referred to House Committee on Public Health",
    );
    expect(r?.name).toBe("House Public Health Committee");
    expect(r?.chamber).toBe("house");
  });

  it("Form B: bounds the body at punctuation", () => {
    const r = parseCommitteeFromAction(
      "Referred to Senate Committee on Judiciary B, scheduled for 3/15",
    );
    expect(r?.name).toBe("Senate Judiciary B Committee");
  });

  it("Form B: lowercases unusual chamber capitalization", () => {
    const r = parseCommitteeFromAction(
      "referred to the assembly committee on codes",
    );
    expect(r?.name).toMatch(/^Assembly\s+codes\s+Committee$/i);
    expect(r?.chamber).toBe("house");
  });

  it("Form B: rejects when body is too short", () => {
    expect(
      parseCommitteeFromAction("Referred to Senate Committee on AB"),
    ).toBeNull();
  });

  it("Prefers Form A over Form B when both could match", () => {
    // Action like "Senate Health Committee voted to refer to Senate
    // Committee on Judiciary" — Form A "Senate Health Committee"
    // wins because it appears first.
    const r = parseCommitteeFromAction(
      "Senate Health Committee voted to refer to Senate Committee on Judiciary",
    );
    expect(r?.name).toBe("Senate Health Committee");
  });

  it("'Died In Committee' (no committee name) returns null", () => {
    // A real OpenStates pattern that doesn't name a committee. We
    // don't try to guess; null is correct.
    expect(parseCommitteeFromAction("Died In Committee")).toBeNull();
  });
});

describe("normalizeCommitteeName", () => {
  it("strips 'committee' token + lowercases", () => {
    expect(normalizeCommitteeName("Senate Health Committee")).toBe("senate health");
  });

  it("preserves commas + ampersands + dashes", () => {
    expect(normalizeCommitteeName("Senate Finance, Ways, and Means Committee")).toBe(
      "senate finance, ways, and means",
    );
    expect(normalizeCommitteeName("House Health & Welfare Committee")).toBe(
      "house health & welfare",
    );
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeCommitteeName("Senate    Health   Committee  ")).toBe(
      "senate health",
    );
  });
});

describe("committeesMatch", () => {
  it("matches identical names", () => {
    expect(
      committeesMatch("Senate Health Committee", "Senate Health Committee"),
    ).toBe(true);
  });

  it("matches with vs without 'Committee' suffix", () => {
    expect(
      committeesMatch("Senate Health Committee", "Senate Health"),
    ).toBe(true);
  });

  it("matches longer canonical name containing shorter source name", () => {
    // Real case: bill_actions says "Senate Health" (terse style);
    // legislator_committees says "Senate Health Committee".
    expect(committeesMatch("Senate Health", "Senate Health Committee")).toBe(true);
  });

  it("matches when bill_actions short form is contained in long canonical", () => {
    // legislator_committees: "Senate Finance, Ways, and Means Committee"
    // bill_actions might say just "Senate Finance" — that's a valid
    // committee-name shortening worth honoring.
    expect(
      committeesMatch(
        "Senate Finance, Ways, and Means Committee",
        "Senate Finance",
      ),
    ).toBe(true);
  });

  it("does NOT match across chambers", () => {
    expect(
      committeesMatch("Senate Health Committee", "House Health Committee"),
    ).toBe(false);
  });

  it("does NOT match unrelated committees", () => {
    expect(
      committeesMatch("Senate Health Committee", "Senate Judiciary Committee"),
    ).toBe(false);
  });

  it("does not match on the short word 'senate' alone (prevents catastrophic over-match)", () => {
    // Without the >= 8 chars floor this could match every senate committee.
    // With the floor, "senate" (6 chars) normalized is too short to qualify.
    expect(committeesMatch("Senate Committee", "Senate Judiciary Committee")).toBe(
      false,
    );
  });

  it("returns false for empty inputs", () => {
    expect(committeesMatch("", "Senate Health")).toBe(false);
    expect(committeesMatch("Senate Health", "")).toBe(false);
  });
});
