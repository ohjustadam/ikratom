import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { browserUA, chromeMajor } from "../scripts/lib/browser-ua.mjs";

// The Cloudflare rule (2026-11-16) challenges Chrome/5x-12x and Firefox/11x-12x.
const STALE = /Chrome\/(?:[5-9]\d|1[0-2]\d)\.|Firefox\/1[12]\d\./;

describe("browserUA (our own calls through Cloudflare)", () => {
  it("is a current Chrome, outside the challenged range", () => {
    expect(chromeMajor(Date.UTC(2026, 10, 16))).toBeGreaterThanOrEqual(150);
    expect(browserUA()).not.toMatch(STALE);
    expect(browserUA()).toMatch(/^Mozilla\/5\.0 .*Chrome\/\d+\.0\.0\.0 Safari\/537\.36 iKratom-Cron\/1\.0/);
  });

  it("the stale pattern really catches the old hard-coded UA", () => {
    expect("AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36").toMatch(STALE);
  });

  it("smoke-check and revalidate use it, not a hard-coded version", () => {
    for (const f of ["scripts/smoke-check.mjs", "scripts/lib/revalidate.mjs"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).toContain("browserUA(");
      expect(src, f).not.toMatch(STALE);
    }
  });
});
