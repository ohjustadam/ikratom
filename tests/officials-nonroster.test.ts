import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isNonRosterPage, isNonGoverningCountyTitle } from "../scripts/lib/officials-extract.mjs";

/**
 * Regression pin (2026-10-09): the batch filed Kidder County ND's Auditor and
 * Greene County NY's two Board of Elections commissioners as those counties'
 * representatives, because it read them off elections pages. Election and
 * records offices are not seats on the governing board.
 */
describe("isNonRosterPage", () => {
  it("rejects the two pages that produced wrong officials", () => {
    expect(isNonRosterPage("https://www.sos.nd.gov/elections/voter/current-officials/county-election-officials")).toBe(true);
    expect(isNonRosterPage("https://greenecountyny.gov/departments/board-of-elections/")).toBe(true);
  });

  it("rejects other election and records offices", () => {
    expect(isNonRosterPage("https://example.gov/departments/auditor/")).toBe(true);
    expect(isNonRosterPage("https://example.gov/elections")).toBe(true);
    expect(isNonRosterPage("https://example.gov/county-treasurer/staff")).toBe(false); // path segment must be the office itself
    expect(isNonRosterPage("https://example.gov/treasurer/")).toBe(true);
  });

  it("keeps real governing-board rosters", () => {
    for (const url of [
      "https://greenecountyny.gov/meet-your-legislature/",
      "https://www.kendallcountyil.gov/county-board",
      "https://www.co.sheridan.nd.us/departments/commission/",
      "https://www.columbiacountyny.gov/Directory.aspx?did=68",
      "https://dekalbcounty.org/government/county-board/county-board-members/",
    ]) expect(isNonRosterPage(url)).toBe(false);
  });

  it("never throws on a bad URL", () => {
    expect(isNonRosterPage("not a url")).toBe(false);
    expect(isNonRosterPage(undefined)).toBe(false);
  });
});

describe("isNonGoverningCountyTitle", () => {
  it("flags election and administrative offices", () => {
    for (const t of ["Auditor", "County Auditor", "Election Commissioner", "Commissioner, Board of Elections",
      "Clerk of the Board", "County Clerk", "County Treasurer", "Sheriff, MIDDLESEX COUNTY", "Register of Deeds",
      "State's Attorney", "Coroner"]) expect(isNonGoverningCountyTitle(t)).toBe(true);
  });

  it("keeps governing-board titles", () => {
    for (const t of ["Commissioner", "Commission Chair", "County Board Member", "County Legislator",
      "Chairman of the Board of Supervisors", "Commissioner, District 3", "County Executive", null, undefined])
      expect(isNonGoverningCountyTitle(t)).toBe(false);
  });
});

describe("wiring (the guards must actually run)", () => {
  const src = readFileSync(new URL("../scripts/lib/officials-extract.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function extractFromText"));

  it("rejects a non-roster page BEFORE the model is called", () => {
    const guard = body.indexOf("isNonRosterPage(sourceUrl)");
    const model = body.indexOf("aiRouter(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(model);
  });

  it("applies the title filter to counties only (Michigan township clerks/treasurers vote)", () => {
    expect(body).toMatch(/level === "county" && isNonGoverningCountyTitle\(o\.title\)/);
  });
});
