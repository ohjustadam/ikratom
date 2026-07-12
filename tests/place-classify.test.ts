// @ts-nocheck - imports a plain .mjs script module (no type declarations needed)
import { describe, it, expect } from "vitest";
import { classifyFromTypes, parseCensusPlaceName } from "../scripts/lib/place-classify.mjs";

/**
 * Pins the place-kind decision that gates unincorporated-place rejection.
 * The Poydras, LA bug: a CDP whose "CDP" suffix was stripped by
 * normalizeLocality() slipped past the old literal guard and churned the
 * local-rep queue forever. classifyFromTypes must map the real Wikidata P31
 * type labels to the right kind so that never happens again.
 */
describe("classifyFromTypes", () => {
  it("classifies a CDP as unincorporated (the Poydras case)", () => {
    expect(classifyFromTypes(["census-designated place in the United States"])).toBe("unincorporated");
  });

  it("classifies unincorporated communities / hamlets as unincorporated", () => {
    expect(classifyFromTypes(["unincorporated community"])).toBe("unincorporated");
    expect(classifyFromTypes(["hamlet in New York"])).toBe("unincorporated");
  });

  it("classifies real municipalities as incorporated", () => {
    expect(classifyFromTypes(["city in the United States"])).toBe("incorporated");
    expect(classifyFromTypes(["consolidated city-county"])).toBe("incorporated");
    expect(classifyFromTypes(["village in Illinois"])).toBe("incorporated");
    expect(classifyFromTypes(["borough of New Jersey"])).toBe("incorporated");
    expect(classifyFromTypes(["town in Massachusetts"])).toBe("incorporated");
  });

  it("lets INCORP win when a place carries both signals (never false-reject a city)", () => {
    expect(classifyFromTypes(["census-designated place", "city in the United States"])).toBe("incorporated");
  });

  it("returns unknown with no confident signal (caller then proceeds normally)", () => {
    expect(classifyFromTypes([])).toBe("unknown");
    expect(classifyFromTypes(["railway station"])).toBe("unknown");
    expect(classifyFromTypes([undefined, ""])).toBe("unknown");
  });
});

/**
 * The Census places API is the AUTHORITATIVE incorporated-vs-CDP source (Census
 * defines "CDP"). We read the LSAD suffix off each place NAME; this pins that
 * parsing so a "city"/"town" that is part of a real name (Oklahoma City) is
 * never mistaken for the type word, and a CDP is always caught.
 */
describe("parseCensusPlaceName", () => {
  it("reads a CDP suffix as unincorporated (the Poydras case)", () => {
    expect(parseCensusPlaceName("Poydras CDP, Louisiana")).toEqual({ placeKey: "poydras", kind: "unincorporated" });
    expect(parseCensusPlaceName("Chalmette CDP, Louisiana")).toEqual({ placeKey: "chalmette", kind: "unincorporated" });
  });

  it("reads incorporated LSAD suffixes as incorporated, keeping name-internal type words", () => {
    expect(parseCensusPlaceName("New Orleans city, Louisiana")).toEqual({ placeKey: "neworleans", kind: "incorporated" });
    // "Oklahoma City" is the NAME; only the trailing " city" LSAD is stripped.
    expect(parseCensusPlaceName("Oklahoma City city, Oklahoma")).toEqual({ placeKey: "oklahomacity", kind: "incorporated" });
    expect(parseCensusPlaceName("Mount Prospect village, Illinois")).toEqual({ placeKey: "mountprospect", kind: "incorporated" });
    expect(parseCensusPlaceName("Metuchen borough, New Jersey")).toEqual({ placeKey: "metuchen", kind: "incorporated" });
  });

  it("returns null for shapes without a recognized LSAD suffix", () => {
    expect(parseCensusPlaceName("Aguada zona urbana, Puerto Rico")).toBeNull();
    expect(parseCensusPlaceName("")).toBeNull();
    expect(parseCensusPlaceName(null)).toBeNull();
  });
});
