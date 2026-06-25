/**
 * Tests for bill-status derivation + display grouping.
 *
 * These phrasings are the actual bug: OK SB 891 read "Becomes law without
 * Governor's signature" yet sat at passed_chamber because the old derivation
 * only matched signed|became law|enacted. Lock the broadened coverage in.
 */
import { describe, it, expect } from "vitest";
import { terminalStatusFromAction, deriveStatusFromAction } from "../scripts/lib/bill-status.mjs";
import { billStatusLabel, billStatusFilterOptions, billStatusMatches } from "@/lib/bill-status";

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
