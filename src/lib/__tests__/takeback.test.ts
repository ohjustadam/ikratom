import { describe, expect, it } from "vitest";
import { extractSponsor, extractBlurb, repealPath } from "../takeback";

describe("extractSponsor", () => {
  it("returns dash for null/empty input", () => {
    expect(extractSponsor(null)).toBe("—");
    expect(extractSponsor("")).toBe("—");
  });

  it("extracts the 'Sponsor + push' line for statutory bans (with periods like 'Sen.')", () => {
    const md = `**Sponsor + push**: Sen. Greg Albritton (R-Atmore) led the SB 226 push in 2016.

Second paragraph.`;
    expect(extractSponsor(md)).toBe("Sen. Greg Albritton (R-Atmore) led the SB 226 push in 2016.");
  });

  it("captures up to first newline, not first period", () => {
    const md = `**Sponsor + push**: Rep. Wendy McNamara (R-Mt. Vernon) carried HB 1019 in 2014. Cited rising 'synthetic drug' concerns.`;
    const out = extractSponsor(md);
    expect(out).toContain("Rep. Wendy McNamara");
    expect(out).toContain("HB 1019");
    expect(out).toContain("synthetic drug");
  });

  it("truncates with ellipsis when result exceeds max", () => {
    const longLine = "Sen. Long Name " + "x".repeat(500);
    const md = `**Sponsor + push**: ${longLine}\n\nNext para.`;
    const out = extractSponsor(md, 50);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
  });

  it("extracts the 'Mechanism' line for admin-rule bans", () => {
    const md = `**Mechanism**: Arkansas's ban was enacted by the Arkansas Department of Health under rule-making authority, not by the state legislature.`;
    expect(extractSponsor(md)).toContain("Arkansas Department of Health");
  });

  it("returns dash when neither marker is present", () => {
    const md = `Some unrelated content with no marker.`;
    expect(extractSponsor(md)).toBe("—");
  });

  it("returns dash if marker is too short (less than 10 chars after colon)", () => {
    const md = `**Sponsor + push**: x.`;
    expect(extractSponsor(md)).toBe("—");
  });
});

describe("extractBlurb", () => {
  it("returns empty string for null/empty input", () => {
    expect(extractBlurb(null)).toBe("");
    expect(extractBlurb("")).toBe("");
  });

  it("strips bold markdown", () => {
    expect(extractBlurb("**Sponsor**: someone did something.")).toBe("Sponsor: someone did something.");
  });

  it("strips italic markdown", () => {
    expect(extractBlurb("This *is* italic.")).toBe("This is italic.");
  });

  it("takes only the first paragraph (split on blank line)", () => {
    const md = "First para line 1.\nFirst para line 2.\n\nSecond para should not appear.";
    const out = extractBlurb(md);
    expect(out).toContain("First para");
    expect(out).not.toContain("Second para");
  });

  it("collapses internal newlines into spaces", () => {
    expect(extractBlurb("A\nB\nC")).toBe("A B C");
  });

  it("truncates to max chars with ellipsis", () => {
    const long = "x".repeat(500);
    const out = extractBlurb(long, 100);
    expect(out.length).toBe(101); // 100 + ellipsis char
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects a custom max", () => {
    expect(extractBlurb("a".repeat(50), 20)).toBe("a".repeat(20) + "…");
  });
});

describe("repealPath", () => {
  it("classifies admin-rule bills", () => {
    const r = repealPath({
      state: "AR",
      bill_number: "AR DEA-list 2016 — administrative ban",
      status: "enacted",
      opposition_summary_md: null,
    });
    expect(r.label).toBe("Admin-rule ban");
    expect(r.cls).toContain("emerald");
  });

  it("classifies DOH-rule bills as admin-rule", () => {
    const r = repealPath({
      state: "RI",
      bill_number: "RI DOH-rule 2017 — administrative ban",
      status: "enacted",
      opposition_summary_md: null,
    });
    expect(r.label).toBe("Admin-rule ban");
  });

  it("classifies Reg-Drugs bills as admin-rule", () => {
    const r = repealPath({
      state: "VT",
      bill_number: "VT Reg-Drugs-2016 — administrative schedule",
      status: "enacted",
      opposition_summary_md: null,
    });
    expect(r.label).toBe("Admin-rule ban");
  });

  it("classifies passed_chamber bills as imminent", () => {
    const r = repealPath({
      state: "TN",
      bill_number: "HB 1649",
      status: "passed_chamber",
      opposition_summary_md: null,
    });
    expect(r.label).toBe("Imminent ban");
    expect(r.cls).toContain("amber");
  });

  it("classifies statutory enacted bills (default fall-through)", () => {
    const r = repealPath({
      state: "AL",
      bill_number: "AL SB 226 (2016)",
      status: "enacted",
      opposition_summary_md: null,
    });
    expect(r.label).toBe("Statutory ban");
  });

  it("does not classify Indiana HB 1019 as admin-rule", () => {
    const r = repealPath({
      state: "IN",
      bill_number: "HB 1019",
      status: "enacted",
      opposition_summary_md: null,
    });
    expect(r.label).toBe("Statutory ban");
  });
});
