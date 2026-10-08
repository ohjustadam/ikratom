import { describe, it, expect } from "vitest";
import { slugCandidates, statesForName, levelForTenant, normLoc, bodiesMatchLevel } from "../scripts/lib/legistar-resolver.mjs";

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
    // statesForName returns null for an unknown name, so assert presence
    // before reading .length — otherwise an unknown name would fail with
    // "cannot read length of null" instead of a useful assertion message.
    expect(cook).not.toBeNull();
    expect(cook).toContain("IL");
    expect(cook!.length).toBeGreaterThan(1); // also GA, MN — ambiguous

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

  it("keeps commission-governed CITIES municipal (the Miami flip)", () => {
    // "City Commission" is the governing body of many cities — it must never
    // flip the level to county (it did pre-fix via /commission/ on the body).
    expect(levelForTenant({ locality: "Miami, FL", body: "City Commission" })).toBe("municipal");
    expect(levelForTenant({ locality: "Gainesville, FL", body: "City Commission" })).toBe("municipal");
    // PA second-class townships are MUNICIPAL governments run by a Board of Supervisors.
    expect(levelForTenant({ locality: "Bedford, PA", body: "Township Board of Supervisors" })).toBe("municipal");
    // County Council / Commissioners Court still derive county off the body.
    expect(levelForTenant({ locality: "Seattle Metro Area", body: "King County Council" })).toBe("county");
  });

  // Cross-LEVEL slug-collision gate. Fixtures are the REAL active bodies of
  // the live tenants (webapi.legistar.com, 2026-06-08). The "salem" tenant is
  // the City of Salem, OR — discovery for Salem County, NJ found it via the
  // bare slug and (pre-fix) cached the wrong government.
  describe("bodiesMatchLevel", () => {
    const SALEM_CITY_OR = ["City Council", "Housing Authority of the City of Salem", "Urban Renewal Agency"];
    const MONTEREY_COUNTY_CA = ["Board of Supervisors", "Alternative Energy and Environment Committee", "Budget Committee"];
    const GUILFORD_COUNTY_NC = ["Board of Commissioners", "Guilford County Homelessness Taskforce", "Board of Commissioners - Work Session"];

    it("rejects a CITY tenant for a county query (the Salem, OR trap)", () => {
      expect(bodiesMatchLevel(SALEM_CITY_OR, "county")).toBeNull();
    });

    it("accepts real county tenants for county queries, picking the clean body", () => {
      expect(bodiesMatchLevel(MONTEREY_COUNTY_CA, "county")).toBe("Board of Supervisors");
      // "Board of Commissioners - Work Session" also matches but is noisy —
      // the canonical short name must win.
      expect(bodiesMatchLevel(GUILFORD_COUNTY_NC, "county")).toBe("Board of Commissioners");
    });

    it("accepts a city tenant for a municipal query and rejects county-only tenants", () => {
      expect(bodiesMatchLevel(SALEM_CITY_OR, "municipal")).toBe("City Council");
      expect(bodiesMatchLevel(MONTEREY_COUNTY_CA, "municipal")).toBeNull();
    });

    it("handles empty/missing body lists", () => {
      expect(bodiesMatchLevel([], "county")).toBeNull();
      expect(bodiesMatchLevel(null, "municipal")).toBeNull();
    });

    it("rejects noisy-ONLY matches (the Oakland, CA trap)", () => {
      // Real body of the City of Oakland, CA tenant — contains "Board of
      // Supervisors" but is a joint MEETING, not a governing body. A county
      // query must not accept it (pre-fix the noisy fallback did).
      const OAKLAND_CITY_CA = [
        "Special Concurrent Meeting Of The Oakland City Council And The Alameda County Board Of Supervisors",
        "Oakland Fire Department",
      ];
      expect(bodiesMatchLevel(OAKLAND_CITY_CA, "county")).toBeNull();
    });

    it("township counter-signal: bare Board of Supervisors is not county evidence on a township tenant", () => {
      const PA_TOWNSHIP = ["Board of Supervisors", "Township Planning Commission"];
      expect(bodiesMatchLevel(PA_TOWNSHIP, "county")).toBeNull();
      // ...but a real county BOS without township markers still passes.
      expect(bodiesMatchLevel(["Board of Supervisors", "Budget Committee"], "county")).toBe("Board of Supervisors");
    });

    it("whitelists Township Committee (NJ governing body) despite the noisy 'committee' token", () => {
      expect(bodiesMatchLevel(["Township Committee", "Zoning Board"], "municipal")).toBe("Township Committee");
    });
  });
});
