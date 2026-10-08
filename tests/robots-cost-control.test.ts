/**
 * robots-cost-control.test.ts — the temporary crawl restriction must actually
 * be temporary, and must not lapse while nobody is watching.
 *
 * Every previous cost-control disallow in this repo relied on a human
 * remembering to delete it, and the file still carried a "REMOVE AFTER THE
 * 2026-09-19 RESET" note for a constraint that had stopped binding. The owner
 * asked (2026-09-08) for one that reverses itself. That only helps if the
 * expiry genuinely fires, so it is pinned here: an expiry nobody verifies is
 * indistinguishable from a permanent rule.
 *
 * SECOND HALF, added 2026-09-17. The expiry fired on 09-16 and this file went
 * green on the lift — correctly, by its own terms, and that was the problem.
 * It verified that the protection switches OFF and nothing verified that the
 * site could afford it being off. Egress went to ~189 MB/day against a
 * sustainable 167 within a day and a half, projecting a breach before the next
 * reset, and the first anyone knew of it was an alert after the fact.
 *
 * So the lift is still asserted — a measure with no end is one nobody decided
 * on — but there is now a test that goes red TWO WEEKS BEFORE the date. A
 * guard that only fires after the protection is gone reports history; this one
 * gives the owner a window in which the lapse is still a choice.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import robots from "../src/app/robots";

/**
 * The expiry is read through robots() with fake timers rather than by parsing
 * the constant out of the source, so renaming or restructuring the constant
 * cannot make these assertions pass vacuously.
 */
const BEFORE_RESET = new Date("2026-10-01T12:00:00Z");
const AFTER_RESET = new Date("2026-11-16T01:00:00Z");

/** Real wall-clock, captured before any test installs fake timers. */
const REAL_NOW = Date.now();
/** How much notice the owner gets before the block lifts itself. */
const NOTICE_DAYS = 14;

/** The default rule is the one ordinary search engines follow. */
function defaultDisallow(): string[] {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const dflt = list.find((r) => r.userAgent === "*") ?? list[0];
  const d = dflt?.disallow ?? [];
  return Array.isArray(d) ? d : [d];
}

afterEach(() => vi.useRealTimers());

describe("cost-control crawl restriction", () => {
  it("is ACTIVE before the expiry date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_RESET);
    const disallow = defaultDisallow();
    // The two biggest URL counts are the whole point of the measure.
    expect(disallow).toContain("/alerts/");
    expect(disallow).toContain("/campaigns/");
    expect(disallow).toContain("/bills/");
    expect(disallow).toContain("/legislators/");
  });

  it("LIFTS ITSELF once the expiry date passes, with no deploy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_RESET);
    const disallow = defaultDisallow();
    expect(disallow).not.toContain("/alerts/");
    expect(disallow).not.toContain("/campaigns/");
    expect(disallow).not.toContain("/bills/");
    expect(disallow).not.toContain("/legislators/");
  });

  it("never stops protecting genuinely private surfaces", () => {
    // These are not cost control — they must hold on BOTH sides of the date.
    for (const when of [BEFORE_RESET, AFTER_RESET]) {
      vi.useFakeTimers();
      vi.setSystemTime(when);
      const disallow = defaultDisallow();
      expect(disallow).toContain("/admin/");
      expect(disallow).toContain("/api/");
      expect(disallow).toContain("/account/");
      expect(disallow).toContain("/messages/");
      vi.useRealTimers();
    }
  });

  it("blocks detail paths without blocking the browsable index pages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_RESET);
    const disallow = defaultDisallow();
    // A trailing slash is what keeps /campaigns and /alerts themselves
    // indexable — they are static now, so crawling them costs nothing.
    for (const p of ["/alerts/", "/campaigns/", "/forum/", "/research/"]) {
      expect(disallow).toContain(p);
      expect(disallow).not.toContain(p.slice(0, -1));
    }
  });

  it(`is still armed ${NOTICE_DAYS} days from now, so a lapse is a decision and not a discovery`, () => {
    // WHY THIS FAILS EARLY. The 09-16 lift was correct by design and still
    // cost ~189 MB/day, because the cheap-to-crawl half of the plan (CDN
    // caching these routes) never shipped. Going red only after the date has
    // passed tells the owner what already happened. Going red two weeks out
    // leaves time to either ship the caching or re-arm deliberately.
    //
    // When this goes red, the fix is one of two things, not a date bump for
    // its own sake: make these routes CDN-cacheable and delete the block, or
    // push COST_CONTROL_EXPIRES_AT out and say in the comment why.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(REAL_NOW + NOTICE_DAYS * 86_400_000));
    const disallow = defaultDisallow();
    for (const p of ["/alerts/", "/campaigns/", "/bills/", "/legislators/"]) {
      expect(disallow).toContain(p);
    }
  });

  it("leaves the now-static state hubs crawlable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_RESET);
    const disallow = defaultDisallow();
    // /states/[code] was converted to SSG — a static page costs nothing to
    // crawl, so restricting it would be pure downside.
    expect(disallow).not.toContain("/states/");
    expect(disallow).not.toContain("/news/");
  });
});
