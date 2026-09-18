/**
 * crawl-policy-agreement.test.ts — robots.txt and sitemap.xml must not
 * contradict each other.
 *
 * WHY (2026-09-18). They are two halves of one decision and they had drifted.
 * robots.ts disallowed sixteen high-cardinality prefixes while sitemap.ts went
 * on advertising ten `/intel/...` pages and every `/library/<id>`,
 * `/campaigns/<slug>` and `/briefings/<slug>` it could find. The withholding in
 * the sitemap had been done by hand, family by family, and covered only the two
 * anyone remembered.
 *
 * Advertising a URL you also forbid is incoherent in both directions: a
 * compliant crawler ignores the entry, and a non-compliant one takes the
 * invitation to a live database render. Both files now read src/lib/crawl-policy,
 * and this pins that they keep doing so.
 *
 * sitemap() itself cannot be called here — it builds a cookie-scoped Supabase
 * client — so the policy is tested directly and the wiring is tested by scanning
 * the source, the same way tests/egress-freeze-expiry.test.ts scans for its
 * marker rather than keeping a list someone has to maintain.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import robots from "../src/app/robots";
import {
  COST_CONTROL_PATHS,
  PRIVATE_PATHS,
  disallowedPaths,
  isDisallowed,
  costControlActive,
  COST_CONTROL_EXPIRES_AT,
} from "../src/lib/crawl-policy";

const WHILE_ACTIVE = new Date("2026-10-01T12:00:00Z").getTime();
const AFTER_EXPIRY = new Date("2026-11-16T01:00:00Z").getTime();

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

afterEach(() => vi.useRealTimers());

describe("crawl policy is one source of truth", () => {
  it("both files read the shared module rather than their own copy", () => {
    const robotsSrc = read("src/app/robots.ts");
    const sitemapSrc = read("src/app/sitemap.ts");
    expect(robotsSrc).toMatch(/from "@\/lib\/crawl-policy"/);
    expect(sitemapSrc).toMatch(/from "@\/lib\/crawl-policy"/);
    // The sitemap must actually APPLY it, not merely import it.
    expect(sitemapSrc).toMatch(/isDisallowed\(/);
    // And neither may reintroduce a hand-kept copy of the prefix list.
    expect(robotsSrc).not.toMatch(/const COST_CONTROL_PATHS = \[/);
    expect(sitemapSrc).not.toMatch(/const COST_CONTROL_PATHS = \[/);
  });

  it("robots.txt disallows exactly what the shared policy says, while active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(WHILE_ACTIVE);
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    const dflt = list.find((r) => r.userAgent === "*") ?? list[0];
    const d = dflt?.disallow ?? [];
    expect([...(Array.isArray(d) ? d : [d])].sort()).toEqual([...disallowedPaths(WHILE_ACTIVE)].sort());
  });

  it("flags every family the sitemap was advertising against the block", () => {
    // The exact set that was contradicting robots.txt before this landed.
    for (const url of [
      "https://www.ikratom.org/intel/operations",
      "https://www.ikratom.org/intel/operations/network",
      "https://www.ikratom.org/intel/threat-matrix",
      "https://www.ikratom.org/library/abc-123",
      "https://www.ikratom.org/campaigns/some-slug",
      "https://www.ikratom.org/briefings/some-brief",
    ]) {
      expect(isDisallowed(url, WHILE_ACTIVE)).toBe(true);
    }
  });

  it("leaves the index pages and the static families advertisable", () => {
    // The trailing slash is what keeps these crawlable, and they are the pages
    // the block deliberately does not touch.
    for (const url of ["/intel", "/campaigns", "/library", "/briefings", "/news", "/states/ok", "/"]) {
      expect(isDisallowed(url, WHILE_ACTIVE)).toBe(false);
    }
  });

  it("gives the cost-control families back when the block lifts, with no deploy", () => {
    expect(costControlActive(WHILE_ACTIVE)).toBe(true);
    expect(costControlActive(AFTER_EXPIRY)).toBe(false);
    for (const p of COST_CONTROL_PATHS) {
      expect(isDisallowed(`${p}thing`, WHILE_ACTIVE)).toBe(true);
      expect(isDisallowed(`${p}thing`, AFTER_EXPIRY)).toBe(false);
    }
  });

  it("never gives the private surfaces back", () => {
    for (const p of PRIVATE_PATHS) {
      expect(isDisallowed(`${p}whatever`, AFTER_EXPIRY)).toBe(true);
    }
  });

  it("treats an unparseable URL as advertisable rather than silently dropping it", () => {
    // Failing toward "advertise" keeps a malformed entry visible in the output
    // instead of vanishing from the sitemap with nothing to show for it.
    expect(isDisallowed("http://[not-a-url", WHILE_ACTIVE)).toBe(false);
  });

  it("keeps the expiry in step with the robots guard", () => {
    // Two dates that must never diverge: this one and the one the
    // robots-cost-control guard asserts. Pinned so a future re-arm moves both.
    expect(COST_CONTROL_EXPIRES_AT).toBe(Date.UTC(2026, 10, 16));
  });
});
