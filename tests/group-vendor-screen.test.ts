/**
 * Groups are for advocacy, not selling (owner, 2026-11-03; migration 0309).
 * r/kratom's moderators won't promote a platform with groups that promote
 * vendors. The server check and the database trigger must agree, so the
 * trigger's patterns are read from the migration and run against the same
 * cases.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { groupTextIssue, SELLING_RE } from "../src/modules/coalitions/vendor-screen";
import { explicitBanAsk, groupBanAim } from "../src/lib/letter-stance";

// A group that exists to ban kratom (owner, 2026-11-05; migration 0312).
const BAN_AIMS = [
  "Ban Kratom Now",
  "Ban Kratom Coalition",
  "Ban kratom in Oklahoma",
  "Outlaw Kratom",
  "Kratom should be banned.",
  "Citizens to Ban Kratom",
  "Oklahoma Parents to Ban Kratom",
  "Coalition to Ban Kratom in Tulsa",
  "Oklahomans for a Kratom Ban",
  "Moms for a Kratom Ban",
  "Our mission is to ban kratom.",
  "We are working to ban kratom in Texas.",
  "We're fighting to ban kratom.",
  "We support a ban on kratom.",
  "Tulsa Parents\nWe work to ban kratom.",
];
const NOT_BAN_AIMS = [
  "Rein In Chaos Coalition\nRein in Chaos is a kratom leaf advocacy network that strives to unite Kratom leaf Consumers, Kratom leaf Advocates, Supporters and Vendors regardless of the State they reside in.",
  "Just Like Alcohol.\nAll legalizers are welcome.\nExpanding the 21st amendment to cover all intoxicants and repealing the Controlled Substances Act is the goal.",
  "Keep Kratom Legal",
  "Stop the Kratom Ban",
  "Don't Ban Kratom",
  "Oklahomans Against a Kratom Ban",
  "Parents for Kratom Regulation",
  "Moms for a Kratom Ban Repeal",
  "Ban Kratom Bans",
  "Fight the Coalition to Ban Kratom",
  "Fighting Plans to Ban Kratom",
  "Efforts to ban kratom are back in Oklahoma, and we need you.",
  "Lawmakers tried to ban kratom last year. We stopped them.",
  "The coalition to ban kratom is lying to you about the science.",
  "Our goal is to stop any ban on kratom.",
  "We work to ban 7-OH products and keep natural kratom legal.",
  "We are working to ban kratom extracts, not the leaf.",
  "We are working to ban kratom sales to minors.",
  "Why ban kratom?",
  "Ban kratom?",
  "Opponents say kratom should be banned. We disagree.",
];

const ADVOCACY = [
  "Rein in Chaos is a kratom leaf advocacy network that strives to unite Kratom leaf Consumers, Kratom leaf Advocates, Supporters and Vendors regardless of the State they reside in.",
  "Shop owners for KCPA: kratom shop owners writing their legislators together",
  "Tulsa advocates. Hearing details at https://oklahoma.gov/x and https://www.okhouse.gov",
  "We meet monthly. 100% volunteer, 0% off-topic.",
];
const SELLING = [
  "Use code SAVE10 for 20% off",
  "Free shipping on all orders this week",
  "Red Bali for sale, DM me",
  "Wholesale kratom, price list on request",
  "Best leaf at https://bestkratom.com",
  "Our store: greenleaf.shop",
  "Call 405-555-0123 to order",
];

describe("groupTextIssue", () => {
  it.each(ADVOCACY)("allows advocacy text: %s", (t) => expect(groupTextIssue(t)).toBeNull());
  it.each(SELLING)("refuses selling or links: %s", (t) => expect(groupTextIssue(t)).not.toBeNull());
  it.each(BAN_AIMS)("refuses a ban aim: %s", (t) => expect(groupTextIssue(t)).toMatch(/ban kratom/));
  it.each(NOT_BAN_AIMS)("allows: %s", (t) => expect(groupTextIssue(t)).toBeNull());
});

describe("the group forms stay out of the letter check", () => {
  it("leaves a letter that quotes a group's name to the AI", () => {
    expect(groupBanAim("Citizens to Ban Kratom")).toBe(true);
    expect(explicitBanAsk("Citizens to Ban Kratom")).toBe(false);
  });
});

describe("the database guard (0312) never refuses what the server allows", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/0312_coalition_ban_guard.sql"), "utf8");
  // (?n) is Postgres for the JS m flag; \M is a word boundary.
  const patterns = [...sql.matchAll(/t ~\* '\(\?n\)([^']+)'/g)].map((m) => new RegExp(m[1].replace(/\\M/g, "\\b"), "im"));
  const refused = (t: string) => patterns.some((re) => re.test(t));

  it("reads both patterns from the migration", () => expect(patterns).toHaveLength(2));

  it("holds the plainest forms", () => {
    for (const t of ["Ban Kratom Now", "Outlaw Kratom", "Citizens to Ban Kratom", "Oklahomans for a Kratom Ban"]) expect(refused(t)).toBe(true);
  });

  it("refuses nothing the server check allows", () => {
    for (const t of [...ADVOCACY, ...NOT_BAN_AIMS]) expect(refused(t)).toBe(false);
    for (const t of BAN_AIMS) if (refused(t)) expect(groupBanAim(t)).toBe(true);
  });
});

describe("the database guard (0309) matches the server check", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/0309_coalition_vendor_guard.sql"), "utf8");
  // Postgres word boundaries \m and \M become \b for the JS check.
  const pg = (re: string) => new RegExp(re.replace(/\\[mM]/g, "\\b"), "i");
  const words = pg(/t ~\* '(\\m\(coupons[^']+)'/.exec(sql)![1]);
  const percent = pg(/or t ~\* '([^']+)'/.exec(sql)![1]);
  const sells = (t: string) => words.test(t) || percent.test(t);

  it("reads both patterns from the migration", () => {
    expect(words.source).toContain("coupons?");
    expect(percent.source).toContain("% off");
  });

  it("agrees with SELLING_RE on every case", () => {
    for (const t of [...ADVOCACY, ...SELLING]) expect(sells(t)).toBe(SELLING_RE.test(t));
  });
});
