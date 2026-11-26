/**
 * The smart link box's duplicate logic and its campaign staleness gate
 * (src/lib/link-box.ts), plus guards that no automatic approver can publish a
 * draft the box makes (migration 0335).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  actionWindow, billNumberSpellings, billRefs, decideLink, draftWorthy, headlineKey, isOwnSite,
  looksKratomRelated, matchPlace, normalizeReading, pageMeta, pickBill, sameStoryTitle, stateFromUrl,
  statesInText, titleSearchTerms, titleSimilarity, type Found, type StoryHit,
} from "../src/lib/link-box";

const NOW = new Date("2026-11-25T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const story = (id: string, extra: Partial<StoryHit> = {}): StoryHit => ({
  id, title: `Story ${id}`, source_name: null, duplicate_of: null, bill_id: null, state: null, ...extra,
});
const none: Found = { urlStories: [], urlAlerts: [], urlBills: [], titleStories: [] };

describe("pageMeta", () => {
  it("reads og tags and an absolute canonical", () => {
    const m = pageMeta(
      `<head><title>Fallback</title><meta property="og:title" content="Kratom ban advances &amp; more">
       <meta name="description" content="A House panel voted 7-4."><link rel="canonical" href="/news/kratom-ban"></head>`,
      "https://www.example.com/amp/news/kratom-ban?utm_source=x",
    );
    expect(m.title).toBe("Kratom ban advances & more");
    expect(m.description).toBe("A House panel voted 7-4.");
    expect(m.canonical).toBe("https://www.example.com/news/kratom-ban");
  });

  it("falls back to <title> and og:url, and refuses a non-web canonical", () => {
    const m = pageMeta(`<title> Plain  title </title><link href="javascript:alert(1)" rel="canonical">`, "https://a.org/x");
    expect(m.title).toBe("Plain title");
    expect(m.canonical).toBeNull();
    expect(pageMeta(`<meta property="og:url" content="https://pub.com/a">`, "https://msn.com/b").canonical).toBe("https://pub.com/a");
  });
});

describe("headline matching", () => {
  it("drops the outlet suffix but keeps a hyphenated word", () => {
    expect(headlineKey("Oklahoma House passes 7-OH ban - The Oklahoman")).toBe("oklahoma house passes 7-oh ban");
  });

  it("matches a syndicated copy and rejects a different story", () => {
    const a = "Florida lawmakers file bill to ban 7-OH kratom products statewide - WFLA";
    expect(sameStoryTitle(a, "Florida lawmakers file bill to ban 7-OH kratom products statewide | Yahoo News")).toBe(true);
    expect(sameStoryTitle(a, "Florida lawmakers file bill to regulate kratom vendors near schools")).toBe(false);
  });

  it("needs an exact match for a short headline", () => {
    expect(sameStoryTitle("Kratom ban fails", "Kratom ban passes")).toBe(false);
    expect(titleSimilarity("", "Kratom")).toBe(0);
  });

  it("searches on the longest distinct words", () => {
    expect(titleSearchTerms("The kratom moratorium extended in Tennessee county")).toEqual(["moratorium", "tennessee", "extended", "kratom"]);
  });
});

describe("bill numbers, states and places", () => {
  it("reads spelled-out, dotted and URL bill numbers", () => {
    expect(billRefs("House Bill 1784 and S.B. 0891 move on")).toEqual(["HB 1784", "SB 891"]);
    expect(billRefs("http://www.oklegislature.gov/BillInfo.aspx?Bill=SB891&session=2500")).toEqual(["SB 891"]);
    expect(billRefs("HJR 5 heads to the floor")).toEqual(["HJR 5"]);
  });

  it("skips single-letter prefixes and non-bills", () => {
    expect(billRefs("A 2025 study of 1200 people; HRS 12")).toEqual([]);
  });

  it("spells a number the ways it may be stored", () => {
    expect(billNumberSpellings("HB 1784")).toEqual(["HB 1784", "HB1784", "H.B. 1784"]);
  });

  it("names states without false friends", () => {
    expect(statesInText("West Virginia senators met")).toEqual(["WV"]);
    expect(statesInText("The Washington Post reports on Texas")).toEqual(["TX"]);
    expect(statesInText("New York and Virginia")).toEqual(["NY", "VA"]);
  });

  it("reads a state from a legislature or LegiScan address", () => {
    expect(stateFromUrl("https://legiscan.com/OK/bill/HB1784/2021")).toBe("OK");
    expect(stateFromUrl("https://billstatus.ls.state.ms.us/documents/2025/html/HB/HB1077SG.htm")).toBe("MS");
    expect(stateFromUrl("http://www.oklegislature.gov/BillInfo.aspx")).toBe("OK");
    expect(stateFromUrl("https://example.com/ok/")).toBeNull();
  });

  it("matches a tracked town only when its state is real", () => {
    const rows = [{ id: "1", locality: "Oxford, MS", state: "MS" }, { id: "2", locality: "Officials, DA", state: "TX" }];
    expect(matchPlace("Oxford aldermen vote on kratom", rows).map((r) => r.id)).toEqual(["1"]);
    expect(matchPlace("Officials say kratom is popular", rows)).toEqual([]);
  });

  it("picks a bill only when exactly one candidate is left", () => {
    expect(pickBill([])).toBeNull();
    expect(pickBill([{ id: "a" }, { id: "a" }])).toEqual({ id: "a" });
    expect(pickBill([{ id: "a" }, { id: "b" }])).toBeNull();
  });

  it("knows our own site and kratom words", () => {
    expect(isOwnSite("https://www.ikratom.org/bills/1")).toBe(true);
    expect(isOwnSite("https://ikratom.org.evil.com/")).toBe(false);
    expect(looksKratomRelated("FDA moves on 7-OH products")).toBe(true);
    expect(looksKratomRelated("City council approves budget")).toBe(false);
  });
});

describe("decideLink: duplicate or new", () => {
  it("an exact link to a story wins, and a twin shows its keeper", () => {
    const v = decideLink({ ...none, urlStories: [story("twin", { duplicate_of: "keep" }), story("keep")], urlAlerts: [{ id: "a", title: "t", moderation_status: "approved", bill_id: null, locality: "OK" }] });
    expect(v).toMatchObject({ kind: "story", story: { id: "keep" }, via: "link" });
  });

  it("a published or pending tip with the same link is a duplicate", () => {
    const pend = { id: "p", title: "t", moderation_status: "pending", bill_id: null, locality: "OK" };
    const pub = { ...pend, id: "q", moderation_status: "approved" };
    expect(decideLink({ ...none, urlAlerts: [pend, pub] })).toMatchObject({ kind: "alert", alert: { id: "q" } });
    expect(decideLink({ ...none, urlAlerts: [pend] })).toMatchObject({ kind: "alert", alert: { id: "p" } });
  });

  it("a link we hid or rejected is not queued again", () => {
    expect(decideLink({ ...none, urlStories: [story("x", { active: false })] }).kind).toBe("seen");
    expect(decideLink({ ...none, urlAlerts: [{ id: "r", title: "t", moderation_status: "rejected", bill_id: null, locality: "OK" }] }).kind).toBe("seen");
  });

  it("a bill's own page, then a same-headline story, then new", () => {
    const bill = { id: "b", state: "OK", bill_number: "HB 1784", title: null };
    expect(decideLink({ ...none, urlBills: [bill], titleStories: [story("h")] })).toMatchObject({ kind: "bill" });
    expect(decideLink({ ...none, titleStories: [story("h")] })).toMatchObject({ kind: "story", via: "headline" });
    expect(decideLink(none).kind).toBe("new");
  });
});

describe("the campaign staleness gate", () => {
  const live = { active: true, status: "committee", last_action: "Referred to Judiciary", last_action_at: daysAgo(20), scope: "state", kratom_relevance: "anti" };

  it("a moving state bill that restricts kratom may start a draft", () => {
    expect(draftWorthy(live, NOW)).toEqual({ ok: true, reason: "it is still moving" });
  });

  it("never for a settled, ended or quiet bill", () => {
    expect(draftWorthy({ ...live, status: "dead" }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, status: "enacted" }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, last_action: "Signed by Governor" }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, session_sine_die: true }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, active: false }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, last_action_at: daysAgo(200) }, NOW)).toEqual({ ok: false, reason: "no movement in 200 days" });
    expect(draftWorthy({ ...live, last_action_at: null }, NOW).ok).toBe(false);
  });

  it("never for a bill we support, a synthetic-only bill, or a federal one", () => {
    expect(draftWorthy({ ...live, kratom_relevance: "pro" }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, targets_synthetic_only: true, targets_natural_leaf: false }, NOW).ok).toBe(false);
    expect(draftWorthy({ ...live, scope: "federal" }, NOW).ok).toBe(false);
  });

  it("a local ordinance is open only with a meeting ahead, and goes to a person", () => {
    const meeting = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();
    const local = { ...live, scope: "municipal", last_action_at: daysAgo(90) };
    expect(actionWindow(local, NOW).open).toBe(false);
    expect(actionWindow({ ...local, local_meta: { meeting_at: meeting } }, NOW).open).toBe(true);
    expect(draftWorthy({ ...local, local_meta: { meeting_at: meeting } }, NOW)).toEqual({ ok: false, reason: "not a state bill" });
  });
});

describe("normalizeReading", () => {
  it("keeps valid fields and replaces bad ones", () => {
    const r = normalizeReading({ kratom: true, kind: "dea_action", severity: "panic", locality: "ok", action_needed: "yes", summary: "short" }, { kratom: false, summary: "fallback summary text" });
    expect(r).toEqual({ kratom: true, kind: "dea_action", severity: "watch", locality: "OK", actionNeeded: false, summary: "fallback summary text" });
    expect(normalizeReading(null, { kratom: true, summary: "x" }).kind).toBe("news_break");
    expect(normalizeReading({ locality: "DC" }, { kratom: true, summary: "x" }).locality).toBeNull();
  });
});

describe("no automatic approver can publish a link-box draft (mig 0335)", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("the draft is written inactive, pending and held", () => {
    const create = src("src/modules/link-box/create.ts");
    expect(create).toMatch(/active:\s*false/);
    expect(create).toMatch(/review_state:\s*"pending_review"/);
    expect(create).toMatch(/hold_for_person:\s*true/);
    expect(create).toMatch(/action_required:\s*false/);
    for (const f of ["actions.ts", "create.ts", "lookup.ts", "inspect.ts", "classify.ts"]) {
      expect(src(`src/modules/link-box/${f}`)).not.toMatch(/active:\s*true|moderation_status:\s*"approved"/);
    }
  });

  it("each automatic approver skips held rows", () => {
    for (const f of ["scripts/clear-review-queues.mjs", "scripts/auto-approve-campaigns.mjs", "src/modules/admin/queue-resolve-actions.ts"]) {
      expect(src(f), f).toMatch(/\.eq\("hold_for_person", false\)/);
    }
  });
});
