import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BASELINE_TOTAL, BASELINE_TYPES, judgeAdvisors, typeHash } from "../scripts/lib/advisor-baseline.mjs";

const baseline = { total: 3, types: new Set([typeHash("known_a"), typeHash("known_b")]) };
const lints = (...names: string[]) => names.map((name) => ({ name }));

describe("security advisor baseline", () => {
  it("passes at or under the baseline", () => {
    expect(judgeAdvisors(lints("known_a", "known_b", "known_a"), baseline).ok).toBe(true);
    expect(judgeAdvisors(lints("known_a"), baseline).ok).toBe(true);
  });
  it("fails when the count rises", () => {
    const v = judgeAdvisors(lints("known_a", "known_a", "known_a", "known_b"), baseline);
    expect(v.ok).toBe(false);
    expect(v.over).toBe(1);
  });
  it("fails on a new kind even under the count", () => {
    const v = judgeAdvisors(lints("known_a", "brand_new"), baseline);
    expect(v.ok).toBe(false);
    expect(v.newTypes).toEqual(["brand_new"]);
  });
  it("treats an empty reading as a failed read, never as clean", () => {
    const v = judgeAdvisors([], baseline);
    expect(v.readNothing).toBe(true);
    expect(v.ok).toBe(false);
  });
  it("holds the reviewed baseline", () => {
    expect(BASELINE_TOTAL).toBeGreaterThan(0);
    expect(BASELINE_TYPES.size).toBe(5);
  });
});

describe("the check keeps finding names out of public places", () => {
  const src = readFileSync("scripts/check-security-advisors.mjs", "utf8");
  it("logs and records the summary only", () => {
    expect(src.match(/console\.log\(/g)).toHaveLength(1);
    expect(src).toMatch(/console\.log\(summary\)/);
    expect(src).toMatch(/notes: summary/);
  });
  it("runs every week", () => {
    expect(readFileSync(".github/workflows/cron-weekly.yml", "utf8")).toMatch(/scripts\/check-security-advisors\.mjs/);
  });
});
