import { describe, it, expect } from "vitest";
import { formatSummaryMd, formatPublicSummaryMd, normalizePosition } from "@/modules/calls/summary-format";

/**
 * Build #4 guard: the PUBLIC call-intel summary must never carry a named
 * official's verbatim quotes (publishing those from a private call is the
 * wiretap-contents/publication risk we're avoiding). The PRIVATE summary keeps
 * them for the caller + admin moderation view. This test pins that split.
 */
const PARSED = {
  summary_md: "Rep Smith discussed HB123 and is leaning against a full ban.",
  legislator_position: "opposed",
  key_quotes: ["I won't support banning a plant people rely on", "call it gas-station heroin"],
  follow_up_needed: "Send the safety study.",
  concerns_raised_by_legislator: ["youth access", "addiction potential"],
};

describe("call summary formatting", () => {
  it("private summary INCLUDES verbatim quotes (caller + admin only)", () => {
    const md = formatSummaryMd(PARSED);
    expect(md).toContain("Key quotes");
    for (const q of PARSED.key_quotes) expect(md).toContain(q);
  });

  it("public summary is QUOTE-FREE but keeps position + concerns (the legal safeguard)", () => {
    const pub = formatPublicSummaryMd(PARSED);
    expect(pub).not.toContain("Key quotes");
    for (const q of PARSED.key_quotes) expect(pub).not.toContain(q);
    // still carries the intel value
    expect(pub.toLowerCase()).toContain("opposed");
    expect(pub).toContain("youth access");
  });

  it("public summary strips a quote even if the model slips one into the prose", () => {
    const sneaky = {
      summary_md: 'Rep Lee said "ban gas-station heroin now" and pushed back hard.',
      legislator_position: "opposed",
      key_quotes: [],
      concerns_raised_by_legislator: ["youth access"],
    };
    const pub = formatPublicSummaryMd(sneaky);
    expect(pub).not.toContain("ban gas-station heroin now");
    expect(pub).toContain("[…]");
    expect(pub.toLowerCase()).toContain("opposed");
  });

  it("normalizePosition validates the enum", () => {
    expect(normalizePosition("opposed")).toBe("opposed");
    expect(normalizePosition("OPPOSED")).toBe("opposed");
    expect(normalizePosition("not_discussed")).toBe("not_discussed");
    expect(normalizePosition("hostile")).toBeNull();
    expect(normalizePosition(undefined)).toBeNull();
    expect(normalizePosition("")).toBeNull();
  });
});
