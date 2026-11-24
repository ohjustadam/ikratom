/**
 * crawl-policy-agreement.test.ts — robots.txt and sitemap.xml must not
 * contradict each other, at any crawl stage.
 *
 * WHY (2026-09-18). They are two halves of one decision and they had drifted.
 * robots.ts disallowed sixteen high-cardinality prefixes while sitemap.ts went
 * on advertising ten `/intel/...` pages and every `/library/<id>`,
 * `/campaigns/<slug>` and `/briefings/<slug>` it could find.
 *
 * Advertising a URL you also forbid is incoherent in both directions: a
 * compliant crawler ignores the entry, and a non-compliant one takes the
 * invitation to a live database render. Both files read src/lib/crawl-policy,
 * and this pins that they keep doing so, now for every stage of the lift
 * (2026-11-24: the date-based lift became `site_config.crawl_stage`).
 *
 * sitemap() itself cannot be called here — it builds a cookie-scoped Supabase
 * client — so the policy is tested directly and the wiring is tested by scanning
 * the source, the same way tests/egress-freeze-expiry.test.ts scans for its
 * marker rather than keeping a list someone has to maintain.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const hoisted = vi.hoisted(() => ({ stage: 0 }));
vi.mock("../src/lib/crawl-stage", () => ({ getCrawlStage: async () => hoisted.stage }));

import robots from "../src/app/robots";
import {
  COST_CONTROL_PATHS,
  CRAWL_STAGES,
  NEVER_LIFTED_PATHS,
  PRIVATE_PATHS,
  disallowedPaths,
  isDisallowed,
} from "../src/lib/crawl-policy";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

async function defaultDisallow(stage: number): Promise<string[]> {
  hoisted.stage = stage;
  const rules = (await robots()).rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const dflt = list.find((r) => r.userAgent === "*") ?? list[0];
  const d = dflt?.disallow ?? [];
  return Array.isArray(d) ? d : [d];
}

describe("crawl policy is one source of truth", () => {
  it("both files read the shared module and the live stage, not their own copy", () => {
    const robotsSrc = read("src/app/robots.ts");
    const sitemapSrc = read("src/app/sitemap.ts");
    expect(robotsSrc).toMatch(/from "@\/lib\/crawl-policy"/);
    expect(sitemapSrc).toMatch(/from "@\/lib\/crawl-policy"/);
    expect(robotsSrc).toMatch(/getCrawlStage\(\)/);
    expect(sitemapSrc).toMatch(/getCrawlStage\(\)/);
    // The sitemap must actually APPLY the policy, with the stage, not merely import it.
    expect(sitemapSrc).toMatch(/isDisallowed\([^)]*stage\)/);
    // And neither may reintroduce a hand-kept copy of the prefix list.
    expect(robotsSrc).not.toMatch(/const COST_CONTROL_PATHS = \[/);
    expect(sitemapSrc).not.toMatch(/const COST_CONTROL_PATHS = \[/);
  });

  it("robots.txt disallows exactly what the shared policy says, at every stage", async () => {
    for (const stage of [0, 1, 2, 3]) {
      expect([...(await defaultDisallow(stage))].sort()).toEqual([...disallowedPaths(stage)].sort());
    }
  });

  it("flags every family the sitemap was advertising against the block (stage 0)", () => {
    for (const url of [
      "https://www.ikratom.org/intel/operations",
      "https://www.ikratom.org/intel/operations/network",
      "https://www.ikratom.org/intel/threat-matrix",
      "https://www.ikratom.org/library/abc-123",
      "https://www.ikratom.org/campaigns/some-slug",
      "https://www.ikratom.org/briefings/some-brief",
      "https://www.ikratom.org/bills/abc",
      "https://www.ikratom.org/research/abc",
      "https://www.ikratom.org/legislators/abc",
    ]) {
      expect(isDisallowed(url, 0)).toBe(true);
    }
  });

  it("opens a staged family in the sitemap exactly when robots.txt opens it", () => {
    for (const [n, fams] of Object.entries(CRAWL_STAGES)) {
      for (const f of fams) {
        expect(isDisallowed(`${f}thing`, Number(n) - 1)).toBe(true);
        expect(isDisallowed(`${f}thing`, Number(n))).toBe(false);
      }
    }
  });

  it("never opens the never-lifted families or the private surfaces, at any stage", () => {
    for (const stage of [0, 1, 2, 3]) {
      for (const p of [...NEVER_LIFTED_PATHS, ...PRIVATE_PATHS]) {
        expect(isDisallowed(`${p}whatever`, stage)).toBe(true);
      }
    }
  });

  it("leaves the index pages and the static families advertisable", () => {
    // The trailing slash is what keeps these crawlable, and they are the pages
    // the block deliberately does not touch.
    for (const url of ["/intel", "/campaigns", "/library", "/briefings", "/news", "/states/ok", "/"]) {
      expect(isDisallowed(url, 0)).toBe(false);
    }
  });

  it("treats an unparseable URL as advertisable rather than silently dropping it", () => {
    // Failing toward "advertise" keeps a malformed entry visible in the output
    // instead of vanishing from the sitemap with nothing to show for it.
    expect(isDisallowed("http://[not-a-url", 0)).toBe(false);
  });

  it("COST_CONTROL_PATHS is exactly the stage-0 block (staged plus never-lifted)", () => {
    const staged = Object.values(CRAWL_STAGES).flat();
    expect([...COST_CONTROL_PATHS].sort()).toEqual([...staged, ...NEVER_LIFTED_PATHS].sort());
    expect(COST_CONTROL_PATHS).toHaveLength(16); // the sixteen families robots.ts always blocked
  });
});
