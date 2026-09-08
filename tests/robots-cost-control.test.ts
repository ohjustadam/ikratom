/**
 * robots-cost-control.test.ts — the temporary crawl restriction must actually
 * be temporary.
 *
 * Every previous cost-control disallow in this repo relied on a human
 * remembering to delete it, and the file still carried a "REMOVE AFTER THE
 * 2026-09-19 RESET" note for a constraint that had stopped binding. The owner
 * asked (2026-09-08) for one that reverses itself. That only helps if the
 * expiry genuinely fires, so it is pinned here: an expiry nobody verifies is
 * indistinguishable from a permanent rule.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import robots from "../src/app/robots";

const BEFORE_RESET = new Date("2026-09-10T12:00:00Z");
const AFTER_RESET = new Date("2026-09-16T01:00:00Z");

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
  it("is ACTIVE before the 2026-09-16 egress cycle reset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_RESET);
    const disallow = defaultDisallow();
    // The two biggest URL counts are the whole point of the measure.
    expect(disallow).toContain("/alerts/");
    expect(disallow).toContain("/campaigns/");
    expect(disallow).toContain("/bills/");
    expect(disallow).toContain("/legislators/");
  });

  it("LIFTS ITSELF once the reset date passes, with no deploy", () => {
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
