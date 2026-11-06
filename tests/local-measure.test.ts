import { describe, it, expect } from "vitest";
import { isLocalMeasure } from "../scripts/lib/local-measure.mjs";

describe("isLocalMeasure", () => {
  it.each([
    ["State Representative Tim Turner announced in September 2026 he will file a Schedule I bill for the 2027 session", "Oklahoma"],
    ["Lawmakers may be poised to pass new laws to ban kratom products; stories shared during an interim study Oct. 12 at the Capitol", "Oklahoma"],
    ["After passing the House, the bill now heads to the Michigan Senate for consideration.", "Michigan"],
    ["North Carolina House Bill 328 (sponsored at the state level; pending in the House as of July 2026)", "North Carolina"],
    ["HB 1649 (Matthew Davenport's Law) banning kratom statewide effective July 1, 2026", "Tennessee"],
    ["Legislation S4552A/A2340A amends public health law to prohibit the sale of kratom products to individuals under 21", "New York"],
    ["Rep. Michelle McGaw's bill (2026-H 7518) had a hearing before the House Corporations Committee March 12", "Rhode Island"],
    ["A Kansas law prohibiting the sale and possession of kratom is set to take effect on July 1st, 2026.", "Kansas"],
    ["Legislation that would ban kratom; sponsor not stated; advancing toward floor vote in Tennessee legislature", "Tennessee"],
    ["One plan (senate bill 1558) wants to follow Connecticut's lead and ban the sale of kratom entirely", "Connecticut"],
  ])("drops a state item: %s", (note, state) => {
    expect(isLocalMeasure(note, state)).toBe(false);
  });

  it.each([
    ["Ald. Tim Durkee (R-1st Ward) is proposing a ban on 7-OH products in Rockford. The issue awaits a council-wide vote", "Illinois"],
    ["Suffolk County Legislature To Hold Public Hearing Today On Proposed Kratom Ban.", "New York"],
    ["Local Law No. 16, sponsored by Legislator William Murray, scheduled for committee hearings starting October 8, 2026.", "New York"],
    ["Sponsored by District 2 Commissioner Bob Ellis; passed as a resolution by Fulton County commissioners on 2026-09-17", "Georgia"],
    ["A resolution to request the State Legislature to ban the sale of Kratom in Tennessee will be presented by the Jackson City Council", "Tennessee"],
    ["proposed ban to be discussed at the Legislature's meeting next week", "New York"],
    ["Mount Clemens city officials on Monday evening will begin considering regulating the sale of kratom", "Michigan"],
    ["Introduced by eleven legislators on August 11, 2026, with a vote scheduled for Tuesday, September 8, 2026", "New York"],
  ])("keeps local action: %s", (note, state) => {
    expect(isLocalMeasure(note, state)).toBe(true);
  });

  it("treats an empty note as nothing to keep", () => {
    expect(isLocalMeasure("", "Ohio")).toBe(false);
    expect(isLocalMeasure(null, "Ohio")).toBe(false);
  });
});
