import { describe, expect, it } from "vitest";
import { extractDoi, isAbstractPlaceholder } from "../research-doi-lookup";

describe("extractDoi", () => {
  it("extracts a DOI from an Ovid URL", () => {
    const url = "https://www.ovid.com/jnls/amjforensicmedicine/abstract/10.1097/paf.0000000000001140~7-hydroxymitragynine-not-your-garden-variety-kratom?redirectionsource=fulltextview";
    expect(extractDoi(url)).toBe("10.1097/paf.0000000000001140");
  });

  it("extracts a DOI from a doi.org URL", () => {
    expect(extractDoi("https://doi.org/10.1126/science.abc1234")).toBe("10.1126/science.abc1234");
  });

  it("extracts a DOI from inline text in HTML", () => {
    const html = '<meta name="citation_doi" content="10.1038/nature12345">';
    expect(extractDoi(html)).toBe("10.1038/nature12345");
  });

  it("returns null when no DOI is present", () => {
    expect(extractDoi("https://example.com/some-page")).toBeNull();
  });

  it("returns null for empty / null input", () => {
    expect(extractDoi(null)).toBeNull();
    expect(extractDoi(undefined)).toBeNull();
    expect(extractDoi("")).toBeNull();
  });

  it("strips trailing punctuation from a DOI", () => {
    // DOIs can technically contain most chars but rarely end with these.
    expect(extractDoi("see 10.1097/paf.0000000000001140.")).toBe("10.1097/paf.0000000000001140");
    expect(extractDoi("ref: 10.1234/abc;")).toBe("10.1234/abc");
  });

  it("lowercases the DOI for stable dedup", () => {
    expect(extractDoi("10.1097/PAF.0000000000001140")).toBe("10.1097/paf.0000000000001140");
  });
});

describe("isAbstractPlaceholder", () => {
  it("detects the Ovid 'Abstract was not provided' string", () => {
    expect(isAbstractPlaceholder("Abstract was not provided for this article.")).toBe(true);
  });

  it("detects 'No abstract available'", () => {
    expect(isAbstractPlaceholder("No abstract available")).toBe(true);
    expect(isAbstractPlaceholder("No abstract provided.")).toBe(true);
  });

  it("treats null / empty / very short strings as placeholders", () => {
    expect(isAbstractPlaceholder(null)).toBe(true);
    expect(isAbstractPlaceholder(undefined)).toBe(true);
    expect(isAbstractPlaceholder("")).toBe(true);
    expect(isAbstractPlaceholder("short")).toBe(true);
  });

  it("returns false for a real abstract", () => {
    const real = "Kratom (Mitragyna speciosa) is a tropical plant in the coffee family. Its leaves contain over 40 alkaloids, including mitragynine and 7-hydroxymitragynine, which bind to opioid receptors. This study examined adverse-event reports across 200 cases…";
    expect(isAbstractPlaceholder(real)).toBe(false);
  });

  it("returns false for a moderate-length real text", () => {
    const real = "We examined 50 cases of 7-OH product exposure with confirmed urine metabolomics. The cohort showed bimodal distribution between recreational and self-medicating use patterns.";
    expect(isAbstractPlaceholder(real)).toBe(false);
  });
});
