import { describe, expect, it } from "vitest";
import {
  LETTER_TEMPLATES, PLACEHOLDER_PROMPTS, fillTemplate, missingRequired, placeholdersIn, templatesFor,
} from "@/modules/compose/letter-templates";

describe("letter templates", () => {
  it("every placeholder a template uses has a prompt (so the fill-in step can ask for it)", () => {
    for (const t of LETTER_TEMPLATES) {
      for (const p of placeholdersIn(t.subject, t.body).filter((n) => n !== "bill_suffix")) {
        expect(PLACEHOLDER_PROMPTS[p], `${t.id} uses {{${p}}} with no prompt`).toBeTruthy();
      }
    }
  });

  it("every template keeps the platform's message rules", () => {
    for (const t of LETTER_TEMPLATES) {
      // Natural leaf vs 7-OH is the core distinction; thank-you notes reference it too.
      expect(t.body, t.id).toMatch(/7-OH/);
      expect(t.body.toLowerCase(), t.id).not.toMatch(/\bcure|\btreat(s|ment)?\b|street/);
    }
  });

  it("reports only REQUIRED blanks as missing; the optional story never blocks", () => {
    const names = placeholdersIn("{{my_name}} {{my_city}} {{my_story}}");
    expect(missingRequired(names, { my_name: "Sam" })).toEqual(["my_city"]);
    expect(missingRequired(names, { my_name: "Sam", my_city: "Albany" })).toEqual([]);
  });

  it("fills values and collapses an empty optional paragraph cleanly", () => {
    const out = fillTemplate("Hi {{my_name}},\n\n{{my_story}}\n\nThanks", { my_name: "Sam", my_story: "" });
    expect(out).toBe("Hi Sam,\n\nThanks");
  });

  it("offers local templates on meeting pages and legislator templates on bill pages", () => {
    expect(templatesFor("local").map((t) => t.id)).toContain("hearing_regulate_not_ban");
    expect(templatesFor("bill").map((t) => t.id)).toContain("kcpa_support");
    expect(templatesFor("bill").map((t) => t.id)).not.toContain("hearing_regulate_not_ban");
  });
});
