import { describe, it, expect } from "vitest";
import { stateFromJurisdiction } from "../scripts/lib/officials-extract.mjs";

/**
 * Regression pin for the wrong-state bug (2026-06-22): the SearXNG+Ollama
 * extractor pulled Lakewood, WASHINGTON's council for a "Lakewood, OH" request
 * because the jurisdiction check only matched the city name. stateFromJurisdiction
 * reads the state out of the model's page_jurisdiction so extractFromText can
 * reject a same-named city in a different state before publishing it.
 */
describe("stateFromJurisdiction", () => {
  it("reads the trailing-comma state (full name)", () => {
    expect(stateFromJurisdiction("City of Lakewood, Washington")).toBe("WA");
    expect(stateFromJurisdiction("Cuyahoga County, Ohio")).toBe("OH");
    expect(stateFromJurisdiction("City of Troy, Michigan")).toBe("MI");
    expect(stateFromJurisdiction("Fergus County, Montana")).toBe("MT");
  });

  it("reads a trailing 2-letter abbreviation", () => {
    expect(stateFromJurisdiction("Charleston, WV")).toBe("WV");
    expect(stateFromJurisdiction("Lakewood, OH")).toBe("OH");
  });

  it("handles District of Columbia", () => {
    expect(stateFromJurisdiction("Washington, D.C.")).toBe("DC");
  });

  it("disambiguates West Virginia vs Virginia (longest-first, no comma)", () => {
    expect(stateFromJurisdiction("City of Charleston West Virginia")).toBe("WV");
  });

  it("returns null when no state is named (never forces a rejection)", () => {
    expect(stateFromJurisdiction("City of Lakewood")).toBeNull();
    expect(stateFromJurisdiction("")).toBeNull();
    expect(stateFromJurisdiction(null)).toBeNull();
  });

  it("the bug case: a WA jurisdiction is NOT read as the requested OH", () => {
    const claimed = stateFromJurisdiction("City of Lakewood, Washington");
    expect(claimed).not.toBe("OH");
    expect(claimed && claimed !== "OH").toBe(true); // → extractFromText rejects
  });
});
