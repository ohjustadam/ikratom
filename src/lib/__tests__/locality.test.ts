import { describe, expect, it } from "vitest";
import { normalizeLocality } from "../locality";

describe("normalizeLocality", () => {
  it("returns null for null/undefined/empty", () => {
    expect(normalizeLocality(null)).toBe(null);
    expect(normalizeLocality(undefined)).toBe(null);
    expect(normalizeLocality("")).toBe(null);
    expect(normalizeLocality("   ")).toBe(null);
  });

  it("title-cases a simple lowercase city", () => {
    expect(normalizeLocality("oklahoma city, OK")).toBe("Oklahoma City, OK");
    expect(normalizeLocality("dallas, tx")).toBe("Dallas, TX");
  });

  it("uppercases state code", () => {
    expect(normalizeLocality("Marshall, il")).toBe("Marshall, IL");
  });

  it("handles already-canonical input", () => {
    expect(normalizeLocality("Oklahoma City, OK")).toBe("Oklahoma City, OK");
  });

  it("splits on LAST comma so embedded commas work", () => {
    // Real-world example: "Saint Paul, MN" or "Salt Lake City, UT"
    expect(normalizeLocality("Salt Lake City, UT")).toBe("Salt Lake City, UT");
  });

  it("handles Mc-prefixed names", () => {
    expect(normalizeLocality("mcallen, TX")).toBe("McAllen, TX");
    expect(normalizeLocality("mckinney, tx")).toBe("McKinney, TX");
  });

  it("handles Mac-prefixed names with > 4 chars (capitalizes 4th char)", () => {
    expect(normalizeLocality("macarthur, IL")).toBe("MacArthur, IL");
  });

  it("does NOT special-case short Mac words (Mack)", () => {
    // "mack" is 4 chars — falls to the regular title-case branch
    expect(normalizeLocality("mack, IN")).toBe("Mack, IN");
  });

  it("uses defaultState when no comma in input", () => {
    expect(normalizeLocality("Tulsa", "OK")).toBe("Tulsa, OK");
    expect(normalizeLocality("topeka", "KS")).toBe("Topeka, KS");
  });

  it("returns city-only when no comma AND no defaultState", () => {
    expect(normalizeLocality("Tulsa")).toBe("Tulsa");
  });

  it("collapses multiple internal whitespace", () => {
    expect(normalizeLocality("oklahoma     city, OK")).toBe("Oklahoma City, OK");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeLocality("  marshall, il  ")).toBe("Marshall, IL");
  });

  it("returns city-only when state-portion is invalid (not EXACTLY 2 letters)", () => {
    // Previously: function did `.slice(0, 2)` on "illinois" → "IL", which
    // worked by coincidence but failed for "missouri" → "MI" (Michigan).
    expect(normalizeLocality("Marshall, illinois")).toBe("Marshall");
    expect(normalizeLocality("Marshall, I")).toBe("Marshall");
  });

  it("does NOT corrupt full state names by truncation (regression test)", () => {
    // Bug fixed 2026-05-15: was returning "Springfield, MI" (Michigan)
    // for inputs spelled out as "missouri".
    expect(normalizeLocality("Springfield, missouri")).toBe("Springfield");
    expect(normalizeLocality("Springfield, michigan")).toBe("Springfield");
    // Confirms valid 2-letter codes still work
    expect(normalizeLocality("Springfield, MO")).toBe("Springfield, MO");
    expect(normalizeLocality("Springfield, MI")).toBe("Springfield, MI");
  });

  it("handles multi-word city names", () => {
    expect(normalizeLocality("new york city, NY")).toBe("New York City, NY");
    expect(normalizeLocality("oklahoma city, OK")).toBe("Oklahoma City, OK");
  });

  it("preserves the case of mixed names like O'Fallon", () => {
    // O'Fallon: title-case after the apostrophe is NOT specially handled.
    // The function only title-cases the first letter of each space-separated
    // word. So "o'fallon, mo" becomes "O'fallon, MO". This documents
    // current behavior (could be a future enhancement).
    expect(normalizeLocality("o'fallon, MO")).toBe("O'fallon, MO");
  });
});
