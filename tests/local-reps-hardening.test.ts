import { describe, it, expect } from "vitest";
import { sameOfficial, nameParts } from "../scripts/lib/official-names.mjs";
import { noCountyGovernment } from "../scripts/lib/no-county-government.mjs";
import { termEndOrNull } from "../scripts/lib/officials-extract.mjs";

/**
 * Pins the fixes from clearing the local-rep queue by hand (2026-10-07/08).
 * Every case below is a real record that went wrong in production.
 */
describe("sameOfficial — spelling variants are one person", () => {
  it.each([
    ["Pilar Faulkner", "Pilar F.H. Faulkner"],        // Santa Fe duplicate
    ["Jasi Mikae Edwards", "Jasi Edwards"],           // Trenton duplicate
    ["Kenneth Jenkins", "Ken Jenkins"],               // Westchester duplicate
    ["Kenneth W. Jenkins", "Ken Jenkins"],
    ["Rick Blangiardi", "Richard Blangiardi"],
    ["Dustin R. Hillis", "Dustin Hillis"],
    ["Julie T. Beard", "Julie Turner Beard"],
    ['Cornelius "CC" Calhoun', "Cornelius Calhoun"],
    ["Glen O. Pruitt, Jr.", "Glen Pruitt"],
    ["Esther Kiaʻāina", "Esther Kiaaina"],
    ["MARIAN T. RYAN", "Marian Ryan"],
  ])("%s = %s", (a, b) => expect(sameOfficial(a, b)).toBe(true));

  it.each([
    ["Michael J. Garcia", "Lee Garcia"],              // Santa Fe: two real Garcias
    ["Shanae Williams", "Jewel Williams Johnson"],     // Westchester: different people
    ["Jim Duran", "Jamie Duran"],                     // nickname for a different name
    ["Anna Hernandez", "Amilcar Hernandez"],
  ])("%s ≠ %s", (a, b) => expect(sameOfficial(a, b)).toBe(false));

  it("needs a first and last name", () => {
    expect(nameParts("Mayor")).toBeNull();
    expect(sameOfficial("Smith", "John Smith")).toBe(false);
  });
});

describe("noCountyGovernment", () => {
  it.each([
    ["MA", "Worcester County, MA"], ["MA", "Hampden County, MA"], ["MA", "Middlesex County, MA"],
    ["MA", "Berkshire County, MA"], ["MA", "Suffolk County, MA"],
    ["CT", "Capitol Planning Region, CT"], ["CT", "Northwest Hills Planning Region, CT"],
    ["RI", "Providence County, RI"],
  ])("%s %s has none", (st, loc) => {
    const why = noCountyGovernment(st, loc);
    expect(why).toMatch(/^No county government/);
    expect(why!.length).toBeLessThanOrEqual(200); // reject_reason column cap
  });

  it.each([
    ["MA", "Plymouth County, MA"], ["MA", "Barnstable County, MA"], ["MA", "Norfolk County, MA"],
    ["NY", "Westchester County, NY"], ["ND", "Burleigh County, ND"],
  ])("%s %s keeps its government", (st, loc) => expect(noCountyGovernment(st, loc)).toBeNull());
});

describe("termEndOrNull — 'next election' is not a term end", () => {
  const page = "District Attorney: MARIAN T. RYAN - NORTHERN DISTRICT, Next election 2026 Sheriff: PETER J. KOUTOUJIAN, Next election 2028";
  it("drops the YYYY-01-01 guess made from 'Next election YYYY'", () => {
    expect(termEndOrNull("2026-01-01", page)).toBeNull();
    expect(termEndOrNull("2028-01-01", page)).toBeNull();
  });
  it("keeps a real stated date", () => {
    expect(termEndOrNull("2026-12-07", "Term: December 5, 2022 - December 7, 2026")).toBe("2026-12-07");
    expect(termEndOrNull("2027-01-01", page)).toBe("2027-01-01"); // year not tied to an election
  });
  it("rejects non-dates", () => {
    expect(termEndOrNull("2026", page)).toBeNull();
    expect(termEndOrNull(null, page)).toBeNull();
  });
});
