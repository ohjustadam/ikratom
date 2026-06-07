import { describe, it, expect } from "vitest";
import {
  APPROVE_COLUMNS as ENGINE_APPROVE,
  REJECT_COLUMNS as ENGINE_REJECT,
  SUPERSEDE_COLUMNS as ENGINE_SUPERSEDE,
} from "../scripts/lib/campaign-review-columns.mjs";
import {
  APPROVE_COLUMNS as TS_APPROVE,
  REJECT_COLUMNS as TS_REJECT,
  SUPERSEDE_COLUMNS as TS_SUPERSEDE,
} from "@/modules/admin/campaign-review-shared";
import { isCampaignWorthyAlert, ELIGIBILITY_PATTERNS } from "../scripts/lib/campaign-eligibility.mjs";
import { topicKey, normalizedTitleKey, strongTopicKey, billKey } from "../scripts/lib/topic-key.mjs";

/**
 * Build #3 — campaign auto-approve engine guards. The engine is a .mjs (can't
 * import the TS server action), so the column contract is enforced here: the
 * engine and the manual-review path MUST write identical columns, or an
 * automatic approve diverges from a manual one.
 */
describe("review-column contract: engine .mjs ⇄ TS server action", () => {
  it("approve columns are identical", () => {
    expect({ ...ENGINE_APPROVE }).toEqual({ ...TS_APPROVE });
  });
  it("reject columns are identical", () => {
    expect({ ...ENGINE_REJECT }).toEqual({ ...TS_REJECT });
  });
  it("supersede columns are identical", () => {
    expect({ ...ENGINE_SUPERSEDE }).toEqual({ ...TS_SUPERSEDE });
  });
  it("approve is exactly the active=true / auto_active flip", () => {
    expect({ ...ENGINE_APPROVE }).toEqual({ active: true, review_state: "auto_active" });
  });
});

/**
 * Nonpartisan hard rule (CLAUDE.md) encoded as CI: the patterns that decide
 * which events become campaigns must never reference an advocacy org or a
 * political party — suppression must be event-shape-based, never side-based.
 */
describe("nonpartisan guard on eligibility patterns", () => {
  const ORG_OR_PARTY = /\b(aka|gkc|bae|mac|democrat|republican|gop|liberal|conservative|leftist|rightwing|party|partisan)\b/i;
  for (const [name, re] of Object.entries(ELIGIBILITY_PATTERNS)) {
    it(`${name} contains no org names or party terms`, () => {
      expect(ORG_OR_PARTY.test((re as RegExp).source)).toBe(false);
    });
  }
});

describe("isCampaignWorthyAlert", () => {
  it("accepts real ban / scheduling pushes", () => {
    expect(isCampaignWorthyAlert("bill_event", "SB123 would ban kratom sales statewide")).toBe(true);
    expect(isCampaignWorthyAlert("fda_action", "FDA moves to schedule 7-OH")).toBe(true);
    expect(isCampaignWorthyAlert("bop_hearing", "Board of Pharmacy hearing on kratom rule")).toBe(true);
  });
  it("keeps LIVE procedural bill states actionable (a bill in motion is still a CTA)", () => {
    expect(isCampaignWorthyAlert("bill_event", "HB45 Kratom Ban — Engrossed in Senate")).toBe(true);
    expect(isCampaignWorthyAlert("bill_event", "SB7 kratom ban reported favorably by committee")).toBe(true);
    // the prime veto-push moment — must NOT be vetoed:
    expect(isCampaignWorthyAlert("bill_event", "HB1234 kratom ban delivered to the Governor")).toBe(true);
  });
  it("vetoes already-concluded events + commentary", () => {
    expect(isCampaignWorthyAlert("bill_event", "Kratom ban signed into law")).toBe(false);
    expect(isCampaignWorthyAlert("fda_action", "Kratom ban takes effect July 1")).toBe(false);
    expect(isCampaignWorthyAlert("bill_event", "Kratom act chaptered into session law")).toBe(false);
    expect(isCampaignWorthyAlert("bill_event", "AKA applauds new KCPA passage")).toBe(false);
  });
  it("vetoes recalls / lawsuits / enforcement / ag_enforcement / news", () => {
    expect(isCampaignWorthyAlert("fda_action", "FDA recalls contaminated kratom product")).toBe(false);
    expect(isCampaignWorthyAlert("fda_action", "Company sued over kratom marketing")).toBe(false);
    expect(isCampaignWorthyAlert("ag_enforcement", "AG settles with kratom vendor")).toBe(false);
    expect(isCampaignWorthyAlert("news_break", "Kratom debated in weekend op-ed")).toBe(false);
  });
});

describe("topicKey / normalizedTitleKey dedup keys", () => {
  it("collapses same state+keyword+event", () => {
    const a = topicKey("TN", "Kratom users concerned about TN's ban");
    const b = topicKey("TN", "Kratom ban in Tennessee threatens local shops");
    expect(a).toBe("TN|kratom|ban");
    expect(a).toBe(b);
  });
  it("does NOT collapse distinct events in the same state", () => {
    const ban = topicKey("FL", "Florida kratom ban introduced");
    const hearing = topicKey("FL", "Florida kratom hearing set");
    expect(ban).not.toBe(hearing);
  });
  it("falls back to normalized title when keyword/event unparseable (no over-collapse)", () => {
    const x = topicKey(null, "Unrelated federal headline about wellness funding");
    expect(x.startsWith("title:")).toBe(true);
  });
  it("normalizedTitleKey ignores case/punctuation but separates distinct titles", () => {
    expect(normalizedTitleKey("Kratom Ban!!!")).toBe(normalizedTitleKey("kratom   ban"));
    expect(normalizedTitleKey("Alpha")).not.toBe(normalizedTitleKey("Beta"));
  });
  it("strongTopicKey collapses ONLY on a specific event (engine dedup safety)", () => {
    expect(strongTopicKey("TX", "Texas kratom ban advances")).toBe("TX|kratom|ban");
    expect(strongTopicKey("TX", "Texas kratom hearing set")).toBe("TX|kratom|hearing");
    // generic words must NOT cluster distinct events → null (caller falls back to title)
    expect(strongTopicKey("TX", "Texas kratom community takes action")).toBeNull();
    expect(strongTopicKey("TX", "Texas kratom proposal floated")).toBeNull();
  });
  it("billKey collapses every procedural step of ONE bill (keyword-free titles)", () => {
    const a = billKey("TX", "TX HB 1097 — Reported engrossed");
    const b = billKey("TX", "TX HB 1097 — Reported favorably as substituted");
    expect(a).toBe("bill:TX|hb1097");
    expect(a).toBe(b);
    expect(billKey(null, "UT HB 301 — Enrolled Bill Returned to House")).toBe("bill:UT|hb301");
    // distinct bills stay distinct; non-bill titles return null
    expect(billKey("TX", "TX SB 1097 — first reading")).not.toBe(a);
    expect(billKey("MO", "Kansas City mayor introduces ban on gas-station heroin")).toBeNull();
  });
});
