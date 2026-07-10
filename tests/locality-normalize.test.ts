import { describe, it, expect } from "vitest";
import { normalizeLocality } from "../src/lib/locality";

describe("normalizeLocality — CDP suffix strip", () => {
  it("strips the Census CDP suffix (the Poydras bug)", () => {
    expect(normalizeLocality("Poydras CDP", "LA")).toBe("Poydras, LA");
    expect(normalizeLocality("Poydras CDP, LA")).toBe("Poydras, LA");
    expect(normalizeLocality("Poydras (CDP)", "LA")).toBe("Poydras, LA");
  });

  it("does NOT strip legitimate place-type words in real names", () => {
    expect(normalizeLocality("Oklahoma City", "OK")).toBe("Oklahoma City, OK");
    expect(normalizeLocality("Lake City", "FL")).toBe("Lake City, FL");
  });

  it("title-cases + attaches the state, parish names intact", () => {
    expect(normalizeLocality("st. bernard parish", "LA")).toBe("St. Bernard Parish, LA");
    expect(normalizeLocality("SAINT BERNARD, LA")).toBe("Saint Bernard, LA");
  });

  it("returns null for empty input", () => {
    expect(normalizeLocality(null)).toBeNull();
    expect(normalizeLocality("  ")).toBeNull();
  });
});
