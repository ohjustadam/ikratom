/**
 * Tests for bill-status derivation + display grouping.
 *
 * These phrasings are the actual bug: OK SB 891 read "Becomes law without
 * Governor's signature" yet sat at passed_chamber because the old derivation
 * only matched signed|became law|enacted. Lock the broadened coverage in.
 */
import { describe, it, expect } from "vitest";
import {
  terminalStatusFromAction,
  deriveStatusFromAction,
  statusFromLegiscanCode,
  legiscanSessionFits,
  twinCorrections,
} from "../scripts/lib/bill-status.mjs";
import { billStatusLabel, billStatusFilterOptions, billStatusMatches, collapseBillTwins } from "@/lib/bill-status";

describe("terminalStatusFromAction", () => {
  it("detects enacted across real state phrasings", () => {
    for (const a of [
      "Becomes law without Governor's signature 05/22/2025", // OK SB 891
      "Approved by Governor 05/24/2021", // OK HB 1784
      "Governor Signed", // CO
      "Signed by the Governor on March 30, 2026 H.J. 580", // SD
      "Chapter 253", // AZ
      "Chapter No. 2023-182", // FL
      "Act No. 35", // SC
      "Enacted", // AL
      "Approved by Governor-Chapter 695 (effective 7/1/2026)", // VA
      "Effective date 8/1/2025.", // LA SB 154
      "Effective date: 08/01/2026.", // LA
      "Effective Date 2025-07-01", // GA
      "Effective date, August 9, 2019.", // OR
      "Effective on 9/1/23", // TX
      "Effective immediately", // TX
      "Effective date(s) 07/01/2018", // TN
      "Acts of Assembly Chapter text (CHAP0595)", // VA
      "Assigned Chapter Number 68", // WY
      "Chapter Number Assigned", // MT
      "SIGNED CHAP.81", // NY
      "approval memo.37", // NY
      "Assigned Pa 0104'26 With Immediate Effect", // MI
      "Governor Line Item Veto", // UT: the rest of the bill is law
    ]) {
      expect(terminalStatusFromAction(a), a).toBe("enacted");
    }
  });

  it("treats a veto override as enacted", () => {
    expect(terminalStatusFromAction("Veto overridden by House")).toBe("enacted");
    expect(terminalStatusFromAction("Passed over the Governor's veto")).toBe("enacted");
  });

  it("detects vetoed and dead", () => {
    expect(terminalStatusFromAction("Vetoed by Governor")).toBe("vetoed");
    expect(terminalStatusFromAction("Died in House at Sine Die adjournment.")).toBe("dead");
    expect(terminalStatusFromAction("Currently Indefinitely Postponed")).toBe("dead");
    expect(terminalStatusFromAction("Failed to pass")).toBe("dead");
  });

  it("does NOT misread a procedural signing as enactment", () => {
    expect(terminalStatusFromAction("Signed by the Speaker")).toBeNull();
    expect(terminalStatusFromAction("Signed by the Clerk")).toBeNull();
  });

  it("returns null when there is no terminal signal", () => {
    expect(terminalStatusFromAction("Referred to Health and Human Services")).toBeNull();
    expect(terminalStatusFromAction("Second Reading")).toBeNull();
    expect(terminalStatusFromAction("")).toBeNull();
    expect(terminalStatusFromAction(null)).toBeNull();
  });
});

describe("deriveStatusFromAction (full ladder)", () => {
  it("maps the non-terminal stages", () => {
    expect(deriveStatusFromAction("Passed House")).toBe("passed_chamber");
    expect(deriveStatusFromAction("Referred to committee")).toBe("committee");
    expect(deriveStatusFromAction("Introduced and read first time")).toBe("introduced");
  });
  it("prefers terminal over non-terminal", () => {
    expect(deriveStatusFromAction("Passed both houses; Approved by Governor")).toBe("enacted");
  });
});

describe("Tennessee public chapters", () => {
  it("reads \"Pub. Ch. 950\" as enacted", () => {
    expect(terminalStatusFromAction("Pub. Ch. 950")).toBe("enacted");
  });
  it("gives a companion of an enacted bill no terminal signal", () => {
    expect(terminalStatusFromAction("Comp. became Pub. Ch. 950")).toBeNull();
  });
});

describe("display labels + filter grouping", () => {
  it("labels every writable status (incl. vetoed/in_committee)", () => {
    expect(billStatusLabel("vetoed")).toBe("Vetoed");
    expect(billStatusLabel("in_committee")).toBe("In committee");
    expect(billStatusLabel("committee")).toBe("In committee");
    expect(billStatusLabel(null)).toBeNull();
  });

  it("collapses committee/in_committee into one filter option", () => {
    const opts = billStatusFilterOptions(["committee", "in_committee", "enacted", "enacted"]);
    const labels = opts.map((o) => o.label);
    expect(labels.filter((l) => l === "In committee")).toHaveLength(1);
    expect(labels).toContain("Enacted");
  });

  it("matches both committee variants under the In committee filter", () => {
    const committeeOpt = billStatusFilterOptions(["in_committee"])[0];
    expect(billStatusMatches("committee", committeeOpt.value)).toBe(true);
    expect(billStatusMatches("in_committee", committeeOpt.value)).toBe(true);
    expect(billStatusMatches("enacted", committeeOpt.value)).toBe(false);
    expect(billStatusMatches("anything", "all")).toBe(true);
  });
});

describe("a bill that became law can't read Dead", () => {
  it("doesn't take an amendment about a date for a law", () => {
    expect(terminalStatusFromAction("Effective date amendment adopted")).toBeNull();
    expect(terminalStatusFromAction("Amended to change the effective date")).toBeNull();
  });

  it("reads LegiScan's code", () => {
    const bill = { billNumber: "HB 1566", lastAction: "Filed with Secretary Of State 04/28" };
    expect(statusFromLegiscanCode({ ...bill, code: 4 })).toBe("enacted");
    expect(statusFromLegiscanCode({ ...bill, code: 5 })).toBe("vetoed");
    expect(statusFromLegiscanCode({ ...bill, code: 6 })).toBe("dead");
    expect(statusFromLegiscanCode({ ...bill, code: 1 })).toBeNull();
  });

  it("leaves a companion to its twin, and calls a resolution adopted, not law", () => {
    expect(statusFromLegiscanCode({ code: 4, billNumber: "SB 1390", lastAction: "Comp. became Pub. Ch. 502" })).toBeNull();
    expect(statusFromLegiscanCode({ code: 4, billNumber: "HR 88", lastAction: "adopted by voice vote" })).toBe("passed_chamber");
    expect(statusFromLegiscanCode({ code: 4, billNumber: "HJR 147", lastAction: "Signed by Governor." })).toBe("enacted");
  });
});

describe("a stored LegiScan id from another session", () => {
  const session = { year_start: 2025, year_end: 2026 };

  it("counts inside the session, plus a year for effective dates", () => {
    expect(legiscanSessionFits("2025-06-04", session)).toBe(true);
    expect(legiscanSessionFits("2027-01-01", session)).toBe(true);
  });

  it("doesn't count on a row from an older session, or with no date", () => {
    expect(legiscanSessionFits("2019-08-20", session)).toBe(false); // MI SB 433
    expect(legiscanSessionFits(null, session)).toBe(false);
  });
});

describe("two rows for one bill", () => {
  const row = (id: string, status: string, bill_number = "HB 360", last_action_at = "2026-04-13") => ({
    id, status, bill_number, last_action_at, state: "VA",
  });

  it("moves the row behind up to its twin's terminal status", () => {
    expect(twinCorrections([row("a", "introduced"), row("b", "enacted")])).toEqual([{ id: "a", next: "enacted" }]);
    expect(twinCorrections([row("a", "dead"), row("b", "enacted")])).toEqual([{ id: "a", next: "enacted" }]);
  });

  it("treats a padded number as the same bill", () => {
    expect(twinCorrections([row("a", "committee", "SF 0056"), row("b", "dead", "SF 56")])).toEqual([{ id: "a", next: "dead" }]);
  });

  it("leaves another session's bill and undated rows alone", () => {
    expect(twinCorrections([row("a", "committee", "HB 360", "2024-02-01"), row("b", "enacted")])).toEqual([]);
    expect(twinCorrections([row("a", "committee", "HB 360", ""), row("b", "enacted", "HB 360", "")])).toEqual([]);
  });

  it("shows the tracker one row per bill, the one that knows the most", () => {
    const shown = collapseBillTwins([row("a", "introduced"), row("b", "dead"), row("c", "enacted"), row("d", "committee", "HB 9")]);
    expect(shown.map((b) => b.id)).toEqual(["c", "d"]);
  });
});
