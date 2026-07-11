import { describe, it, expect } from "vitest";
import { isValidCountyName } from "../src/lib/county-name";

/**
 * adoptDerivedCounty() writes a client-supplied county/parish name onto the
 * user's profile. isValidCountyName is the charset + length gate before that
 * write (coverage is separately re-verified against the legislators table).
 * These pin the real names it must accept and the junk it must reject.
 */
describe("isValidCountyName", () => {
  it("accepts real county / parish / borough names", () => {
    expect(isValidCountyName("St. Bernard Parish")).toBe(true);
    expect(isValidCountyName("Miami-Dade County")).toBe(true);
    expect(isValidCountyName("Prince George's County")).toBe(true);
    expect(isValidCountyName("DeKalb County")).toBe(true);
    expect(isValidCountyName("Matanuska-Susitna Borough")).toBe(true);
    // Unicode letters (New Mexico) must survive.
    expect(isValidCountyName("Doña Ana County")).toBe(true);
  });

  it("rejects empty / whitespace input", () => {
    expect(isValidCountyName("")).toBe(false);
    expect(isValidCountyName("   ")).toBe(false);
  });

  it("rejects names that lead with punctuation or a digit", () => {
    expect(isValidCountyName(".hidden")).toBe(false);
    expect(isValidCountyName("-County")).toBe(false);
    expect(isValidCountyName("123 County")).toBe(false);
  });

  it("rejects control chars / injection-ish payloads", () => {
    expect(isValidCountyName("St. Bernard Parish, LA'); drop")).toBe(false);
    expect(isValidCountyName("<script>")).toBe(false);
    expect(isValidCountyName("County\nOther")).toBe(false);
  });

  it("rejects absurdly long input", () => {
    expect(isValidCountyName("A" + "b".repeat(200))).toBe(false);
  });
});
