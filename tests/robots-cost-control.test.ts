/**
 * robots-cost-control.test.ts — the crawl restriction is a staged switch, it
 * defaults to fully blocked, and nothing sits unreviewed for a year.
 *
 * HISTORY. Every earlier disallow here relied on a human remembering to delete
 * it; the 2026-09-08 version carried an expiry date and lifted itself on 09-16,
 * which cost ~189 MB/day of egress within a day and a half because the
 * cheap-to-crawl half of the plan (caching) had never shipped. On 2026-11-24
 * the lift became `site_config.crawl_stage` (src/lib/crawl-policy.ts):
 *   - the default is 0, exactly the old blocked list, so shipping it changes
 *     nothing until a human raises it;
 *   - anything unreadable is also 0, so the brake never depends on what is failing;
 *   - families that must never lift (member content, alerts, campaigns) are not
 *     on the scale at all.
 * The old tests asserted that the block LIFTS ITSELF on a date. That is gone on
 * purpose. What replaces it: a review date that goes red two weeks before it,
 * so the stage is a decision somebody re-takes.
 */
import { describe, it, expect, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ stage: 0 }));
vi.mock("../src/lib/crawl-stage", () => ({ getCrawlStage: async () => hoisted.stage }));

import robots from "../src/app/robots";
import {
  CRAWL_POLICY_REVIEW_BY,
  CRAWL_STAGES,
  NEVER_LIFTED_PATHS,
  normalizeStage,
} from "../src/lib/crawl-policy";

/** How much notice the owner gets before the policy is due for a look. */
const NOTICE_DAYS = 14;

async function rulesAt(stage: number) {
  hoisted.stage = stage;
  const rules = (await robots()).rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const dflt = list.find((r) => r.userAgent === "*") ?? list[0];
  const disallow = (Array.isArray(dflt?.disallow) ? dflt.disallow : [dflt?.disallow ?? ""]) as string[];
  return { list, disallow };
}

describe("staged crawl restriction", () => {
  it("at stage 0 (the default) every cost-controlled family is blocked, as before", async () => {
    const { disallow } = await rulesAt(0);
    for (const p of ["/alerts/", "/campaigns/", "/bills/", "/legislators/", "/research/", "/library/", "/topics/", "/briefings/", "/forum/", "/coalitions/", "/intel/"]) {
      expect(disallow).toContain(p);
    }
  });

  it("each stage opens its own families and the ones below it, and nothing above", async () => {
    for (const [stage, fams] of Object.entries(CRAWL_STAGES)) {
      const { disallow } = await rulesAt(Number(stage));
      for (const f of fams) expect(disallow).not.toContain(f);
      const above = Object.entries(CRAWL_STAGES).filter(([n]) => Number(n) > Number(stage)).flatMap(([, f]) => f);
      for (const f of above) expect(disallow).toContain(f);
    }
  });

  it("bills and research come first, the cheapest answers to uncontested searches", async () => {
    const { disallow } = await rulesAt(1);
    expect(disallow).not.toContain("/bills/");
    expect(disallow).not.toContain("/research/");
    expect(disallow).toContain("/legislators/");
    expect(disallow).toContain("/briefings/");
  });

  it("never opens member content, alerts, campaigns or intel, even at the top stage", async () => {
    const { disallow } = await rulesAt(3);
    for (const p of NEVER_LIFTED_PATHS) expect(disallow).toContain(p);
    for (const p of ["/forum/", "/coalitions/", "/profile/", "/i/", "/alerts/", "/campaigns/"]) {
      expect(disallow).toContain(p);
    }
  });

  it("never stops protecting genuinely private surfaces, at any stage", async () => {
    for (const stage of [0, 1, 2, 3]) {
      const { disallow } = await rulesAt(stage);
      for (const p of ["/admin/", "/api/", "/account/", "/messages/", "/dashboard/"]) expect(disallow).toContain(p);
    }
  });

  it("citation crawlers follow the same stage as everyone else", async () => {
    const { list, disallow } = await rulesAt(2);
    const oai = list.find((r) => r.userAgent === "OAI-SearchBot");
    expect(oai).toBeDefined();
    expect(oai?.disallow).toEqual(disallow);
  });

  it("training and SEO-scraper crawlers stay blocked from everything at every stage", async () => {
    for (const stage of [0, 3]) {
      const { list } = await rulesAt(stage);
      for (const ua of ["GPTBot", "ClaudeBot", "CCBot", "AhrefsBot"]) {
        const r = list.find((x) => x.userAgent === ua);
        expect(r?.disallow).toBe("/");
      }
    }
  });

  it("blocks detail paths without blocking the browsable index pages", async () => {
    const { disallow } = await rulesAt(0);
    // A trailing slash is what keeps /alerts and /campaigns themselves indexable.
    for (const p of ["/alerts/", "/campaigns/", "/forum/", "/research/"]) {
      expect(disallow).toContain(p);
      expect(disallow).not.toContain(p.slice(0, -1));
    }
  });

  it("leaves the static state hubs and news crawlable", async () => {
    const { disallow } = await rulesAt(0);
    expect(disallow).not.toContain("/states/");
    expect(disallow).not.toContain("/news/");
  });

  it("anything that is not a whole stage from 0 to 3 means stage 0 (fail closed)", () => {
    for (const bad of [-1, 4, 99, 1.5, NaN, Infinity, "abc", "", null, undefined, {}, [], true]) {
      expect(normalizeStage(bad)).toBe(0);
    }
    for (const good of [0, 1, 2, 3]) expect(normalizeStage(good)).toBe(good);
    expect(normalizeStage("2")).toBe(2);
  });

  it(`is not due for review within ${NOTICE_DAYS} days, so the stage is a decision and not a discovery`, () => {
    // Nothing lifts on this date any more. It exists so a stage that has sat at
    // 0 or 1 for months gets looked at with the credit meter and this file open.
    // When this goes red: re-read docs/RUNBOOK_crawl_lift.md, decide the stage,
    // then move CRAWL_POLICY_REVIEW_BY out and say in the comment what you decided.
    expect(Date.now() + NOTICE_DAYS * 86_400_000).toBeLessThan(CRAWL_POLICY_REVIEW_BY);
  });
});
