import { describe, expect, it } from "vitest";
import { briefingDeniesKratom, isUnverifiedStub } from "@/lib/bill-guards";
import { gmailAndroidIntent, buildGmailComposeUrl } from "@/modules/compose/send-links";
import { openingFromText, normBill, KRATOM_TEXT } from "../scripts/verify-stub-bills.mjs";
import { proposeFix, editDistance } from "../scripts/check-legislator-email-domains.mjs";

describe("briefingDeniesKratom (MN HF 4223)", () => {
  it("catches a text-based briefing that says the bill has no kratom provisions", () => {
    expect(briefingDeniesKratom(
      "The bill, in its latest available form, does not introduce any definitions, prohibitions, or requirements pertaining to natural leaf kratom, mitragynine, 7-hydroxymitragynine.",
    )).toBe(true);
    expect(briefingDeniesKratom("This housing bill is unrelated to kratom.")).toBe(true);
  });

  it("does NOT trip on a real 7-OH bill that leaves natural leaf alone", () => {
    expect(briefingDeniesKratom("It schedules 7-OH but does not ban natural leaf kratom.")).toBe(false);
    expect(briefingDeniesKratom(null)).toBe(false);
  });

  it("recognises a news-created stub title", () => {
    expect(isUnverifiedStub("[MI] HB 5509 — auto-extracted from kratom-related coverage")).toBe(true);
    expect(isUnverifiedStub("Regulation and Oversight of Kratom Act")).toBe(false);
  });
});

describe("verify-stub-bills helpers", () => {
  it("normalises bill numbers", () => {
    expect(normBill("H.B. 332")).toBe(normBill("HB332"));
  });

  it("finds kratom and its alkaloids, not unrelated text", () => {
    expect(KRATOM_TEXT.test("relating to the sale of kratom products")).toBe(true);
    expect(KRATOM_TEXT.test("schedules 7-hydroxymitragynine")).toBe(true);
    expect(KRATOM_TEXT.test("A bill to amend the Elliott-Larsen civil rights act")).toBe(false);
  });

  it("titles a bill from its own enacting clause", () => {
    expect(openingFromText("WEST VIRGINIA LEGISLATURE A BILL to amend §49-4-604, relating to drug testing of parents; and more.").title)
      .toBe("Relating to drug testing of parents");
    expect(openingFromText("HOUSE BILL No. 2657 AN ACT Providing for the regulation and sale of kratom products. The General").title)
      .toBe("AN ACT Providing for the regulation and sale of kratom products");
  });
});

describe("email domain fixes", () => {
  const good = ["coffeecountytn.gov", "sullivancountytn.gov", "pahouse.net", "pahousegop.com"];
  it("fixes TLD slips", () => {
    expect(proposeFix("yahoo.con", good)).toBe("yahoo.com");
    expect(proposeFix("wilsoncountytn.go", good)).toBe("wilsoncountytn.gov");
  });
  it("fixes a one- or two-letter slip only when exactly one good domain is that close", () => {
    expect(proposeFix("coffeecoutytn.gov", good)).toBe("coffeecountytn.gov");
    expect(proposeFix("sullvancountytn.gov", good)).toBe("sullivancountytn.gov");
    expect(proposeFix("hhcurarions.com", good)).toBeNull();
  });
  it("measures edit distance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("Gmail on Android", () => {
  it("turns a web compose URL into a Gmail-app intent with a web fallback", () => {
    const web = buildGmailComposeUrl("a@x.gov,b@y.gov", "Kratom & you", "Line 1\n#2", "rec@ikratom.org");
    const intent = gmailAndroidIntent(web)!;
    expect(intent.startsWith("intent:a@x.gov,b@y.gov?subject=Kratom%20%26%20you&bcc=rec%40ikratom.org&body=Line%201%0A%232")).toBe(true);
    expect(intent).toContain("#Intent;scheme=mailto;package=com.google.android.gm;");
    expect(intent).toContain(`S.browser_fallback_url=${encodeURIComponent(web)};end`);
  });
  it("leaves non-Gmail links alone", () => {
    expect(gmailAndroidIntent("https://outlook.office.com/mail/deeplink/compose?to=a")).toBeNull();
    expect(gmailAndroidIntent("mailto:a@x.gov")).toBeNull();
  });
});
