/**
 * Banned-state safe mode (migration 0275): letters from a member in a state
 * that bans kratom must not admit current use, and letters to officials
 * outside that state must not name the member's home.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findUseAdmissions, rewordUseAdmissions } from "../src/lib/use-admission";
import { adaptForHiddenHome, renderSenderOnly } from "../src/modules/campaigns/templates";

describe("findUseAdmissions", () => {
  it("flags first-person statements of current use", () => {
    for (const s of [
      "As a Louisiana resident who relies on kratom, I urge you to act.",
      "I use kratom every morning.",
      "I still take natural kratom for my back.",
      "I've been using kratom for six years.",
      "I have used kratom since 2019.",
      "Kratom helps me work a full shift.",
      "I'm a daily kratom consumer.",
      "As a kratom user, I ask you to reconsider.",
      "My daily kratom use is responsible.",
    ]) expect(findUseAdmissions(s), s).not.toEqual([]);
  });

  it("leaves policy language and past use alone", () => {
    for (const s of [
      "I take no position in this letter on the underlying restriction.",
      "I support sensible regulation that keeps natural leaf kratom legal for adults.",
      "I used kratom before the ban.",
      "Kratom keeps being targeted by bad bills.",
      "Many people rely on kratom to manage pain.",
    ]) expect(findUseAdmissions(s), s).toEqual([]);
  });
});

describe("rewordUseAdmissions", () => {
  it("puts current use in the past tense, keeping the sentence", () => {
    expect(rewordUseAdmissions("As a Louisiana resident who relies on kratom, I urge you"))
      .toBe("As a Louisiana resident who relied on kratom, I urge you");
    expect(rewordUseAdmissions("I still take kratom daily.")).toBe("I took kratom daily.");
    expect(rewordUseAdmissions("I've been using kratom for six years.")).toBe("I used kratom for six years.");
    expect(rewordUseAdmissions("Kratom lets me work.")).toBe("Kratom let me work.");
    expect(rewordUseAdmissions("I'm a daily kratom consumer.")).toBe("I was a daily kratom consumer.");
    expect(rewordUseAdmissions("As a kratom user, I ask")).toBe("As a former kratom user, I ask");
  });

  it("leaves nothing it can reword still flagged", () => {
    const fixed = rewordUseAdmissions("I use kratom. Kratom helps me. I am a kratom consumer.");
    expect(findUseAdmissions(fixed)).toEqual([]);
  });

  it("flags but cannot safely reword 'my kratom use'", () => {
    const t = "My daily kratom use is responsible.";
    expect(rewordUseAdmissions(t)).toBe(t);
    expect(findUseAdmissions(t)).toEqual(["My daily kratom use"]);
  });
});

describe("adaptForHiddenHome", () => {
  // The campaign wizard's default template, as campaigns are created with it.
  const subject = "Constituent input on kratom policy in {{state}}";
  const body = [
    "Dear {{recipient_title}} {{recipient_last_name}},",
    "",
    "My name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}. I am writing about kratom policy.",
    "",
    "Sincerely,",
    "{{full_name}}",
    "{{city}}, {{state}} {{zip}}",
  ].join("\n");
  const vars = {
    full_name: "Pat Doe", street: "", city: "Baton Rouge", state: "LA", zip: "70801",
    legislator_name: "", legislator_role: "", recipient_title: "", recipient_last_name: "", representatives: "",
  };

  it("names no city, state or ZIP and keeps the letter readable", () => {
    const s = renderSenderOnly(adaptForHiddenHome(subject), vars);
    const b = renderSenderOnly(adaptForHiddenHome(body), vars);
    expect(s).toBe("Input on kratom policy");
    expect(b).not.toMatch(/Baton Rouge|\bLA\b|70801|constituent/);
    expect(b).toContain("My name is Pat Doe and I follow kratom policy closely.");
    expect(b.trim().endsWith("Pat Doe")).toBe(true);
    // Each official is still addressed by name.
    expect(b).toContain("Dear {{recipient_title}} {{recipient_last_name}},");
  });

  it("rewrites the other constituent phrasings without leaving a dangling place", () => {
    expect(renderSenderOnly(adaptForHiddenHome("As a {{state}} resident, I urge you."), vars)).toBe("As an advocate, I urge you.");
    expect(renderSenderOnly(adaptForHiddenHome("I'm writing as a constituent about SB 12."), vars)).toBe("I'm writing about SB 12.");
    expect(renderSenderOnly(adaptForHiddenHome("I'm writing from {{city}}, {{state}} about SB 12."), vars)).toBe("I'm writing about SB 12.");
  });
});

describe("safe mode is wired where letters are built", () => {
  const page = readFileSync("src/app/campaigns/[slug]/page.tsx", "utf8");
  const queue = readFileSync("src/modules/campaigns/send-batch-actions.ts", "utf8");
  const personalize = readFileSync("src/modules/campaigns/actions-personalize.ts", "utf8");

  it("the composer hides home for out-of-state officials and shows the card", () => {
    expect(page).toMatch(/hideHome \? adaptForHiddenHome/);
    expect(page).toMatch(/<SafeModeCard/);
    expect(page).toMatch(/safeModeState=/);
  });

  it("the one-click queue applies the same rule to the template path", () => {
    expect(queue).toMatch(/safeMode\?\.active \? adaptForHiddenHome : adaptForNonResident/);
  });

  it("Personalize writes in the past tense and rewords what slips through", () => {
    expect(personalize).toContain("past tense, as life before the ban");
    expect(personalize).toMatch(/banned \? rewordUseAdmissions\(personalized\)/);
  });
});
