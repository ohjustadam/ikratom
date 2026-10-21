import { describe, it, expect } from "vitest";
import { stateFromJurisdiction, hasStateEvidence } from "../scripts/lib/officials-extract.mjs";

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

/**
 * Bruce, MS (2026-10-21): seven officials came from cityofbruce.net, which is
 * Bruce, SOUTH DAKOTA. The page names no state, the gazetteer's no-evidence
 * fallback reports corroborated:true, so nothing objected. The search tier now
 * needs evidence FOR the requested state, from the page text or the host.
 */
describe("hasStateEvidence", () => {
  const noEvidence = { locality: "MS", corroborated: true, confidence: "low", reason: "kept:candidate-no-evidence" };
  const pinned = { locality: "MS", corroborated: true, confidence: "high", reason: "city-state:MS" };
  const ev = (url: string, geo = noEvidence, state = "MS", cityName = "Bruce") => hasStateEvidence({ geo, url, state, cityName });

  it("the bug case: a page that never names its state, on a stateless host, is not evidence", () => {
    expect(ev("http://www.cityofbruce.net/government.php")).toBe(false);
  });

  it("page text that pins the state is evidence", () => {
    expect(ev("http://www.cityofbruce.net/government.php", pinned)).toBe(true);
  });

  it("a high-confidence pin on a DIFFERENT state is not evidence", () => {
    expect(ev("http://www.cityofbruce.net/", { locality: "SD", corroborated: false, confidence: "high", reason: "full-state-name:SD" })).toBe(false);
  });

  it("reads the state from the host", () => {
    expect(ev("https://www.gulfport-ms.gov/government/city_council.php", noEvidence, "MS", "Gulfport")).toBe(true);
    expect(ev("https://ci.bruce.ms.us/")).toBe(true);
    expect(ev("https://www.cityofoxfordms.com/", noEvidence, "MS", "Oxford")).toBe(true);
    expect(ev("https://bruce-mississippi.org/")).toBe(true);
    expect(ev("https://www.portal.ct.gov/x", noEvidence, "CT", "Hartford")).toBe(true);
  });

  it("doesn't read a state out of unrelated letters", () => {
    expect(ev("https://www.cityofadams.org/", noEvidence, "MS", "Adams")).toBe(false); // "adams" ends in "ms"
    expect(ev("https://www.visitarkansas.com/", noEvidence, "KS", "Salina")).toBe(false); // "arkansas" is not Kansas
    expect(ev("https://westvirginia.gov/", noEvidence, "VA", "Bristol")).toBe(false);
  });
});
