import { describe, expect, it } from "vitest";
import { calloutContradictsBriefing } from "../bill-guards";
import { sortBillActions } from "../bill-actions-order";

// NY S 8925A, verbatim from production on 2026-11-16.
const NY_CALLOUT = "Advocates should oppose the alkaloid cap as it would effectively ban most natural leaf product.";
const NY_BRIEFING =
  "S8925 amends the New York General Business Law to prohibit the sale, offer for sale, delivery, or distribution of products containing 7-hydroxymitragynine (7-OH) at levels exceeding 2% of total alkaloids or 1 milligram per serving. The bill defines \"7-hydroxymitragynine products\" narrowly, excluding natural leaf kratom, mitragynine (MGM), pseudoindoxyl, and synthetic alkaloids from its prohibition.";

describe("calloutContradictsBriefing", () => {
  it("hides NY S 8925A's leaf-ban callout (PJ 11-14)", () => {
    expect(calloutContradictsBriefing(NY_CALLOUT, NY_BRIEFING)).toBe(true);
  });

  it("keeps a callout that says the bill does NOT ban leaf", () => {
    const ok = "This bill regulates 7-OH levels but does not ban traditional kratom — advocates should monitor its progress.";
    expect(calloutContradictsBriefing(ok, NY_BRIEFING)).toBe(false);
  });

  it("keeps a leaf-ban callout when the briefing agrees the leaf is banned", () => {
    const briefing = "The bill adds mitragynine and 7-hydroxymitragynine to Schedule I, covering all kratom products including the natural leaf.";
    expect(calloutContradictsBriefing("This bill would ban natural leaf kratom outright.", briefing)).toBe(false);
  });

  it("does nothing without a briefing", () => {
    expect(calloutContradictsBriefing(NY_CALLOUT, null)).toBe(false);
  });

  it("catches 'leaving natural leaf kratom unaddressed' phrasing", () => {
    const briefing = "The bill's scope is limited to 7-OH-enriched products, leaving natural leaf kratom and other alkaloids unaddressed.";
    expect(calloutContradictsBriefing("It would outlaw traditional kratom sales statewide.", briefing)).toBe(true);
  });
});

describe("sortBillActions", () => {
  it("keeps OpenStates' order within a day (ND HB 1628 special session)", () => {
    const rows = [
      { action_date: "2026-09-04", seq: 16, d: "Sent to Governor" },
      { action_date: "2026-09-04", seq: 15, d: "Signed by Speaker" },
      { action_date: "2026-09-03", seq: 5, d: "Received from House" },
      { action_date: "2026-09-04", seq: 17, d: "Signed by Governor 09/04" },
      { action_date: "2026-09-04", seq: 14, d: "Signed by President" },
    ];
    expect(sortBillActions(rows).map((r) => r.d)).toEqual([
      "Received from House", "Signed by President", "Signed by Speaker", "Sent to Governor", "Signed by Governor 09/04",
    ]);
  });

  it("keeps stored order for actions without a sequence (LegiScan)", () => {
    const rows = [
      { action_date: "2026-02-05", seq: null, d: "a" },
      { action_date: "2026-02-05", seq: null, d: "b" },
      { action_date: "2026-01-26", seq: null, d: "c" },
    ];
    expect(sortBillActions(rows).map((r) => r.d)).toEqual(["c", "a", "b"]);
  });
});
