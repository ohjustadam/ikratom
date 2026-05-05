/**
 * Census Geocoder smoke test — guards against the API silently changing
 * (which is what bit us with Google Civic). Verifies we still get back
 * district numbers for a known-good Oklahoma address.
 */

import { describe, it, expect } from "vitest";
import { getDistrictsForAddress } from "@/lib/civic";

describe("Census Geocoder", () => {
  it("returns district numbers for a known OK address", { timeout: 15000 }, async () => {
    const result = await getDistrictsForAddress({
      street: "2300 N Lincoln Blvd",
      city: "Oklahoma City",
      state: "OK",
      zip: "73105",
    });

    // Should resolve all three districts for the OK State Capitol address
    expect(result.congressional_district).toBeTruthy();
    expect(result.state_senate_district).toBeTruthy();
    expect(result.state_house_district).toBeTruthy();
    expect(result.city).toBeTruthy();
    expect(result.county).toContain("County");
  });

  it("returns empty for invalid input gracefully", async () => {
    const result = await getDistrictsForAddress({
      street: "",
      city: "",
      state: "",
    });
    expect(result.congressional_district).toBeNull();
    expect(result.city).toBeNull();
  });
});
