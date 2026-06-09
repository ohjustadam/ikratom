// @ts-nocheck - imports a plain .mjs script module (no type declarations needed)
import { describe, it, expect } from "vitest";
import { slugCandidates, statesForName, levelForTenant, normLoc } from "../scripts/lib/legistar-resolver.mjs";

describe("legistar tenant resolver", () => {
  it("normalizes localities like resolveTenant", () => {
    expect(normLoc("New York, NY")).toBe("new york");
    expect(normLoc("Cook County, IL")).toBe("cook county");
    expect(normLoc("  St. Louis ,  MO ")).toBe("st. louis");
  });

  it("generates the known city slug for San Antonio", () => {
    const slugs = slugCandidates("San Antonio, TX", "TX").map((c) => c.slug);
    expect(slugs).toContain("sanantonio");
    // and a state-disambiguated variant exists
    expect(slugs).toContain("sanantoniotx");
  });

  it("generates county slug variants (with and without state)", () => {
    const slugs = slugCandidates("Cook County, IL", "IL").map((c) => c.slug);
    expect(slugs).toContain("cookcounty");
    expect(slugs).toContain("cookcountyil");
  });

  it("flags state-suffixed candidates as disambiguated", () => {
    const cands = slugCandidates("Columbus, MS", "MS");
    const disamb = cands.filter((c) => c.disambiguated).map((c) => c.slug);
    expect(disamb).toContain("columbusms");
    // bare 'columbus' must NOT be treated as disambiguated (collides with OH/GA)
    const bare = cands.find((c) => c.slug === "columbus");
    expect(bare?.disambiguated).toBe(false);
  });

  it("knows multi-state vs unique place names from the gazetteer", () => {
    const cook = statesForName("Cook County, IL");
    expect(cook).toContain("IL");
    expect(cook.length).toBeGreaterThan(1); // also GA, MN — ambiguous

    const chicago = statesForName("Chicago, IL");
    expect(chicago).toContain("IL");

    // A nonsense name isn't in the gazetteer
    expect(statesForName("Zzznotaplace, ZZ")).toBeNull();
  });

  it("derives municipal vs county level", () => {
    expect(levelForTenant({ locality: "Cook County, IL", body: "Board of Commissioners" })).toBe("county");
    expect(levelForTenant({ locality: "Chicago, IL", body: "City Council" })).toBe("municipal");
    expect(levelForTenant({ locality: "San Francisco, CA", body: "Board of Supervisors" })).toBe("county");
  });
});
