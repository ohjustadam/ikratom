import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pageProbeTargets, probeProblem } from "../scripts/lib/page-probes.mjs";

/** /research/[id] was down five weeks unnoticed (2026-09-08 → 10-13). */
describe("probeProblem", () => {
  const t = { kind: "research paper", path: "/research/abc" };
  it("pages on any 5xx", () => {
    expect(probeProblem(t, 500)).toBe("PAGE TYPE DOWN: research paper pages return 500 (e.g. /research/abc)");
    expect(probeProblem(t, 503)).toMatch(/PAGE TYPE DOWN/);
  });
  it("does not page on 2xx, 3xx, 404 or a Cloudflare 403", () => {
    for (const s of [200, 301, 404, 403]) expect(probeProblem(t, s)).toBeNull();
  });
  it("reports an unreachable page", () => {
    expect(probeProblem(t, 0, "timeout")).toMatch(/UNREACHABLE.*timeout/);
  });
});

describe("pageProbeTargets", () => {
  it("picks the lowest id per type and covers every detail page type", async () => {
    const seen: Array<{ table: string; ordered: string | null }> = [];
    const sb = {
      from(table: string) {
        const rec = { table, ordered: null as string | null };
        seen.push(rec);
        const q = {
          select: () => q,
          eq: () => q,
          order: (col: string) => { rec.ordered = col; return q; },
          limit: () => q,
          maybeSingle: async () => ({ data: { id: `${table}-1` }, error: null }),
        };
        return q;
      },
    };
    const targets = await pageProbeTargets(sb);
    expect(targets.map((t: { kind: string }) => t.kind)).toEqual(
      ["State HQ", "bill", "alert", "research paper", "news article", "legislator"],
    );
    expect(targets.find((t: { kind: string }) => t.kind === "research paper")?.path).toBe("/research/research_papers-1");
    // Stable picks keep the probe a cache hit on a healthy site.
    expect(seen.every((s) => s.ordered === "id")).toBe(true);
  });
});

describe("wiring", () => {
  const src = readFileSync(new URL("../scripts/check-vercel-usage.mjs", import.meta.url), "utf8");
  it("the watchdog probes every type and pages on a problem", () => {
    expect(src).toMatch(/for \(const t of await pageProbeTargets\(sb\)\)/);
    expect(src).toMatch(/const p = probeProblem\(t, status, err\);\s*if \(p\) problems\.push\(p\);/);
  });
  it("probes only when the home page is up (one alert for a full outage)", () => {
    const at = src.indexOf("pageProbeTargets(sb)");
    expect(src.lastIndexOf("if (siteStatus >= 200 && siteStatus < 400)", at)).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf("── Page the owner"));
  });
});
