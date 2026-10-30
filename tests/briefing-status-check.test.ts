import { describe, expect, it } from "vitest";
import { snapshotOf, statusMismatch } from "../scripts/lib/briefing-status-check.mjs";

// Snapshots below are the opening lines of real drafts from 2026-10-29.
const brief = (snap: string) => `## Snapshot\n${snap}\n\n## Active legislation\n* S 1558 · Banning the sale of kratom`;

describe("statusMismatch", () => {
  it("rejects a banned state described as unrestricted (the CT draft)", () => {
    const body = brief("Connecticut currently has no active statutory restrictions specifically targeting kratom, but the landscape remains undefined.");
    expect(statusMismatch(body, "banned")).toMatch(/never says/);
  });

  it("rejects a banned state described as legal (the old MA draft)", () => {
    const body = brief("Massachusetts is a high-activity state. While kratom remains legal, a wave of ban proposals is moving.");
    expect(statusMismatch(body, "banned")).toMatch(/legal or unrestricted/);
  });

  it("accepts banned states whose Snapshot states the ban", () => {
    expect(statusMismatch(brief("Massachusetts currently enforces a statewide emergency ban on natural-leaf kratom under 105 CMR 726.000."), "banned")).toBeNull();
    expect(statusMismatch(brief("Tennessee has a total statewide ban on natural-leaf kratom and 7-OH products."), "banned")).toBeNull();
  });

  it("rejects a legal state described as banned", () => {
    const body = brief("Tennessee has a total statewide ban on natural-leaf kratom and 7-OH products.");
    expect(statusMismatch(body, "kcpa")).toMatch(/says kratom is banned/);
  });

  it("accepts a legal state where only 7-OH is banned", () => {
    const body = brief("Kansas: natural-leaf kratom remains legal, but 7-hydroxymitragynine (7-OH) is specifically banned under HB 2365.");
    expect(statusMismatch(body, "legal")).toBeNull();
  });

  it("only reads the Snapshot, and skips rows with no confirmed status", () => {
    expect(snapshotOf(brief("Short snapshot."))).toBe("Short snapshot.");
    expect(statusMismatch(brief("Kratom is banned."), null)).toBeNull();
  });
});
