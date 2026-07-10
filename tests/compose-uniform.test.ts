/**
 * Tests for the uniform email-compose layer (PR: compose everywhere).
 *
 *  - templates.ts: street NEVER enters a rendered body; placeholder-only
 *    lines that resolve empty are dropped (no stray blank signature lines
 *    or dangling ", " for the 139+ active campaigns using {{street}}).
 *  - default-letter.ts: deterministic prefill/fallback letter — greeting,
 *    honest constituency line, no street, 4k cap.
 *  - send-links.ts: RFC 6068 mailto encoding (%20, never '+').
 */
import { describe, it, expect } from "vitest";
import { renderTemplate, buildVars } from "../src/modules/campaigns/templates";
import { buildDefaultLetter, officialGreeting } from "../src/modules/compose/default-letter";
import {
  buildMailtoUrl,
  buildGmailComposeUrl,
  isContactFormUrl,
} from "../src/modules/compose/send-links";

const PROFILE = {
  full_name: "Pat Advocate",
  username: "pat",
  street: "123 Bayou Rd",
  city: "Poydras",
  state: "LA",
  zip: "70085",
};

describe("buildVars — street privacy", () => {
  it("never exposes the street, even when the profile has one", () => {
    const vars = buildVars(PROFILE, null, []);
    expect(vars.street).toBe("");
    expect(vars.city).toBe("Poydras");
    expect(vars.zip).toBe("70085");
  });
});

describe("renderTemplate — empty-placeholder line collapse", () => {
  const SIG = `Sincerely,
{{full_name}}
{{street}}
{{city}}, {{state}} {{zip}}`;

  it("drops the {{street}} line entirely (legacy templates keep working)", () => {
    const out = renderTemplate(SIG, buildVars(PROFILE, null, []));
    expect(out).toBe(`Sincerely,\nPat Advocate\nPoydras, LA 70085`);
    expect(out).not.toContain("123 Bayou Rd");
  });

  it("drops a city/state/zip line when all fields are empty (no dangling comma)", () => {
    const out = renderTemplate(SIG, buildVars({ ...PROFILE, city: null, state: null, zip: null }, null, []));
    expect(out).toBe(`Sincerely,\nPat Advocate`);
  });

  it("keeps lines with mixed literal text even when vars are empty", () => {
    const out = renderTemplate(
      "I live in {{city}} and vote.",
      buildVars({ ...PROFILE, city: null }, null, []),
    );
    expect(out).toBe("I live in  and vote.");
  });

  it("leaves unknown placeholders untouched", () => {
    const out = renderTemplate("Hello {{recipient_title}} {{recipient_last_name}}", buildVars(PROFILE, null, []));
    expect(out).toBe("Hello {{recipient_title}} {{recipient_last_name}}");
  });
});

describe("default letter", () => {
  const OFFICIAL = { full_name: "Jeff Landry", role: "governor", state: "LA" };

  it("greets executives by office", () => {
    expect(officialGreeting(OFFICIAL)).toBe("Governor Landry");
    expect(officialGreeting({ full_name: "Alan Seabaugh", role: "state_senate" })).toBe("Senator Seabaugh");
    expect(officialGreeting({ full_name: "Jane Doe", title: "Council Member, District 4" })).toBe("Council Member Doe");
  });

  it("claims constituency only when states match, and never includes a street", () => {
    const constituent = buildDefaultLetter({
      official: OFFICIAL,
      sender: { fullName: "Pat", city: "Poydras", state: "LA" },
    });
    expect(constituent.body).toContain("your constituent");
    expect(constituent.body).toContain("Poydras, LA");

    const outsider = buildDefaultLetter({
      official: OFFICIAL,
      sender: { fullName: "Pat", city: "Toledo", state: "OH" },
    });
    expect(outsider.body).not.toContain("your constituent");
    expect(outsider.body).toContain("advocate");
  });

  it("references the bill in subject + body when given", () => {
    const letter = buildDefaultLetter({
      official: OFFICIAL,
      sender: {},
      context: { kind: "bill", billNumber: "HB 1649", billTitle: "Kratom regulation" },
    });
    expect(letter.subject).toContain("HB 1649");
    expect(letter.body).toContain("HB 1649");
  });

  it("works signed-out with a generic signature", () => {
    const letter = buildDefaultLetter({ official: OFFICIAL, sender: {} });
    expect(letter.body).toContain("A concerned advocate");
    expect(letter.body.length).toBeLessThanOrEqual(4000);
  });

  it("shapes the ask + subject by stance", () => {
    const oppose = buildDefaultLetter({
      official: OFFICIAL, sender: {},
      context: { kind: "bill", billNumber: "HB 1649", stance: "oppose" },
    });
    expect(oppose.subject.toLowerCase()).toContain("oppose");
    expect(oppose.body.toLowerCase()).toContain("please oppose hb 1649");

    const support = buildDefaultLetter({
      official: OFFICIAL, sender: {},
      context: { kind: "bill", billNumber: "HB 1649", stance: "support" },
    });
    expect(support.body.toLowerCase()).toContain("please support hb 1649");

    // No stance → the open "where do you stand" ask, no oppose/support verb.
    const neutral = buildDefaultLetter({
      official: OFFICIAL, sender: {},
      context: { kind: "bill", billNumber: "HB 1649" },
    });
    expect(neutral.body).toContain("will you commit to");
  });

  it("weaves an extra recipient-specific ask (e.g. a chair scheduling request)", () => {
    const letter = buildDefaultLetter({
      official: { full_name: "Jane Doe", role: "state_senate", state: "LA" },
      sender: {},
      context: { kind: "bill", billNumber: "SB 5", stance: "oppose", ask: "As chair, please decline to schedule this bill." },
    });
    expect(letter.body).toContain("As chair, please decline to schedule this bill.");
  });
});

describe("send links", () => {
  it("mailto encodes spaces as %20, never '+'", () => {
    const url = buildMailtoUrl("a@b.gov", "two words", "line one\nline two + plus");
    expect(url).toContain("subject=two%20words");
    expect(url).toContain("body=line%20one%0Aline%20two%20%2B%20plus");
    expect(url).not.toMatch(/=[^&]*\+/);
  });

  it("gmail compose keeps form-style encoding", () => {
    const url = buildGmailComposeUrl("a@b.gov", "hi", "body");
    expect(url).toContain("https://mail.google.com/mail/?");
    expect(url).toContain("to=a%40b.gov");
  });

  it("detects webform URLs stored in the email column", () => {
    expect(isContactFormUrl("https://gov.louisiana.gov/contact")).toBe(true);
    expect(isContactFormUrl("sen31@legis.la.gov")).toBe(false);
    expect(isContactFormUrl(null)).toBe(false);
  });
});
