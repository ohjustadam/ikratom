import { describe, expect, it } from "vitest";
import { displayTitle, displaySubtitle } from "../bill-title";

describe("displayTitle", () => {
  it("returns '(untitled)' for null/undefined/empty", () => {
    expect(displayTitle(null)).toBe("(untitled)");
    expect(displayTitle(undefined)).toBe("(untitled)");
    expect(displayTitle("")).toBe("(untitled)");
  });

  it("trims whitespace", () => {
    expect(displayTitle("  Hello  ")).toBe("Hello");
  });

  it("strips bracketed prefix tag", () => {
    expect(displayTitle("[🚫 Restrictive] NY S 5531")).toBe("NY S 5531");
    expect(displayTitle("[anything] Title")).toBe("Title");
  });

  it("cuts at em-dash separator when first part is long enough", () => {
    expect(displayTitle("Marshall, IL — city ordinance bans kratom"))
      .toBe("Marshall, IL");
  });

  it("cuts at en-dash separator", () => {
    expect(displayTitle("Alabama SB 226 – Schedule I classification"))
      .toBe("Alabama SB 226");
  });

  it("cuts at spaced hyphen separator", () => {
    expect(displayTitle("Title Part One - longer description here"))
      .toBe("Title Part One");
  });

  it("ignores em-dash cut if first part is too short (< 8 chars)", () => {
    // "NY S 5" is 6 chars — too short to be the "title" portion
    const out = displayTitle("NY S 5 — Prohibits sale of kratom to under-21 individuals");
    expect(out).not.toBe("NY S 5");
    expect(out).toContain("kratom");
  });

  it("returns full title when under maxChars and no separator", () => {
    expect(displayTitle("Short title with no breaks")).toBe("Short title with no breaks");
  });

  it("cuts at sentence boundary before maxChars when no separator", () => {
    // First sentence ends at position 36 (>= 30 threshold the function uses)
    const md = "A reasonably substantive sentence ends. Second sentence runs longer and exceeds the cap.";
    const out = displayTitle(md, 60);
    expect(out).toBe("A reasonably substantive sentence ends.");
  });

  it("cuts at word boundary with ellipsis when no sentence boundary found", () => {
    const md = "this is a long title with no punctuation that runs past the limit set for display";
    const out = displayTitle(md, 50);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
    // The cut should be at a word boundary in the source: i.e. the
    // ellipsis-stripped output must appear as a prefix of the original
    // followed immediately by whitespace.
    const withoutEllipsis = out.slice(0, -1);
    const nextCharInOrig = md.charAt(withoutEllipsis.length);
    expect(/\s/.test(nextCharInOrig) || nextCharInOrig === "").toBe(true);
  });

  it("strips leading dash variants", () => {
    expect(displayTitle("— Title One")).toBe("Title One");
    expect(displayTitle("· Title Two")).toBe("Title Two");
  });
});

describe("displaySubtitle", () => {
  it("returns null for null/undefined", () => {
    expect(displaySubtitle(null)).toBe(null);
    expect(displaySubtitle(undefined)).toBe(null);
  });

  it("returns the part AFTER em-dash", () => {
    expect(displaySubtitle("Marshall, IL — city ordinance bans kratom"))
      .toBe("city ordinance bans kratom");
  });

  it("returns the part AFTER spaced hyphen", () => {
    expect(displaySubtitle("Title - subtitle text"))
      .toBe("subtitle text");
  });

  it("returns null when no separator", () => {
    expect(displaySubtitle("No separator title")).toBe(null);
  });

  it("strips bracketed prefix before splitting", () => {
    expect(displaySubtitle("[Restrictive] Title — Subtitle"))
      .toBe("Subtitle");
  });

  it("truncates with ellipsis when subtitle exceeds maxChars", () => {
    const subtitle = "x".repeat(300);
    const out = displaySubtitle(`Title — ${subtitle}`, 100);
    expect(out?.endsWith("…")).toBe(true);
    expect(out?.length).toBeLessThanOrEqual(101);
  });
});
