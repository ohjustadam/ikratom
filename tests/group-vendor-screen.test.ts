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
