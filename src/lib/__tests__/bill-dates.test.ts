import { describe, it, expect } from "vitest";
import { findDateInString, extractBillDates } from "../bill-dates";

describe("findDateInString", () => {
  it("parses ISO", () => {
    expect(findDateInString("on 2026-05-15 the gov signed")).toBe("2026-05-15");
  });
  it("parses M/D/YYYY", () => {
    expect(findDateInString("effective 5/15/2026")).toBe("2026-05-15");
  });
  it("parses M/D/YY (2-digit)", () => {
    expect(findDateInString("signed 5/15/26")).toBe("2026-05-15");
  });
  it("parses M-D-YYYY with dashes", () => {
    expect(findDateInString("date 03-12-2026")).toBe("2026-03-12");
  });
  it("parses 'May 15, 2026'", () => {
    expect(findDateInString("approved May 15, 2026 by")).toBe("2026-05-15");
  });
  it("parses 'May 15 2026'", () => {
    expect(findDateInString("approved May 15 2026")).toBe("2026-05-15");
  });
  it("parses '15 May 2026'", () => {
    expect(findDateInString("date 15 May 2026 ratified")).toBe("2026-05-15");
  });
  it("returns null for malformed", () => {
    expect(findDateInString("no date here")).toBeNull();
    expect(findDateInString("13/45/2026")).toBeNull();
  });
});

describe("extractBillDates", () => {
  it("extracts both signed + effective", () => {
    const r = extractBillDates([
      "Signed by Governor 5/15/2026; effective 7/1/2026",
    ]);
    expect(r.signedAt).toBe("2026-05-15");
    expect(r.effectiveDate).toBe("2026-07-01");
  });

  it("extracts effective from 'takes effect' phrase", () => {
    const r = extractBillDates([
      "Public Act 26-99 takes effect January 1, 2027",
    ]);
    expect(r.effectiveDate).toBe("2027-01-01");
  });

  it("infers effective = signed for 'upon passage'", () => {
    const r = extractBillDates([
      "Approved by Governor 4/22/2026; effective upon passage",
    ]);
    expect(r.signedAt).toBe("2026-04-22");
    expect(r.effectiveDate).toBe("2026-04-22");
    expect(r.effectiveOnPassage).toBe(true);
  });

  it("handles 'this act shall take effect' bill-body language", () => {
    const r = extractBillDates([
      "3 Effective Date. This act shall take effect January 1, 2027.",
    ]);
    expect(r.effectiveDate).toBe("2027-01-01");
  });

  it("returns nulls when nothing matches", () => {
    const r = extractBillDates([
      "Referred to committee",
      "Read first time",
      null,
    ]);
    expect(r.signedAt).toBeNull();
    expect(r.effectiveDate).toBeNull();
    expect(r.effectiveOnPassage).toBe(false);
  });

  it("extracts from multiple strings", () => {
    const r = extractBillDates([
      null,
      "Signed by Gov 4/22/2026",
      "Effective date: 7/1/2026",
    ]);
    expect(r.signedAt).toBe("2026-04-22");
    expect(r.effectiveDate).toBe("2026-07-01");
  });

  it("ignores random dates not anchored to signed/effective phrases", () => {
    const r = extractBillDates([
      "Hearing scheduled for 3/14/2026",
      "Vote 13-0 on 4/15/2026",
    ]);
    // No signed/effective anchor → null
    expect(r.signedAt).toBeNull();
    expect(r.effectiveDate).toBeNull();
  });
});
