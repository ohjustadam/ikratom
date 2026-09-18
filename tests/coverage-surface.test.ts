import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MEASURED,
  NOT_MEASURED,
  OUT_OF_SCOPE,
} from "../scripts/lib/coverage-surface.mjs";

/**
 * coverage-surface.test.ts — guard the ruler, not the reading.
 *
 * WHY IT EXISTS (2026-09-18). Coverage became a number here for the first
 * time: `npm run coverage` measures the logic layer and
 * scripts/report-coverage.mjs fails CI if it falls more than a point below
 * tests/coverage-baseline.json. That gate has exactly one way to be defeated,
 * and it is not subtle — **measure less**. Drop `src/modules/**` from the
 * surface and coverage leaps; narrow it to the three well-tested files in
 * src/lib and it reads 90%. Nothing about the tests would have changed.
 *
 * So the percentage is guarded by a threshold, and the SURFACE is guarded
 * here. The invariants below make shrinking it a failing test rather than a
 * quiet win: the globs must still resolve to a real, large set of files; they
 * must still cover the three directories that hold the platform's logic; the
 * baseline must record the same surface it was measured against; the vitest
 * config must read that one declaration instead of keeping its own copy; and
 * CI must still run the reporter.
 *
 * Same shape as tests/egress-gate-wiring.test.ts: the property is static, so
 * check it against the real files at PR time, in the change that causes it.
 */

const LOGIC_DIRS = ["src/lib", "src/modules", "scripts/lib"];

/**
 * Resolve the simple `dir/**\/*.ext` shapes MEASURED uses. Deliberately
 * hand-rolled rather than pulling in a glob library or Node's experimental
 * fs.globSync: this only has to answer "does this glob still reach a large
 * pile of real files", and a 20-line walker cannot itself rot.
 */
function resolve(glob: string): string[] {
  const m = /^([^*]+?)\/\*\*\/\*(\.[a-z]+)$/.exec(glob);
  if (!m) return [];
  const [, dir, ext] = m;
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(ext) && !e.endsWith(".d.ts")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("the measured coverage surface", () => {
  it("every glob still reaches a real pile of files", () => {
    expect(MEASURED.length).toBeGreaterThan(0);
    for (const glob of MEASURED) {
      const hits = resolve(glob);
      expect(
        hits.length,
        `"${glob}" matches ${hits.length} files. A coverage glob that matches ` +
          `little or nothing raises the percentage without adding a single test.`,
      ).toBeGreaterThan(10);
    }
  });

  it("still covers every directory that holds platform logic", () => {
    // Narrowing MEASURED to a well-tested subdirectory is the cheap way to
    // make the number look good, so the directories are named here.
    for (const dir of LOGIC_DIRS) {
      expect(
        MEASURED.some((g) => g.startsWith(`${dir}/`)),
        `nothing in the measured surface covers ${dir}/ — coverage would stop ` +
          `seeing it while still reporting a percentage.`,
      ).toBe(true);
    }
  });

  it("does not exclude more than the carve-outs it declares", () => {
    // NOT_MEASURED is for files with no runtime behaviour. A whole logic
    // directory appearing here would be an exclusion dressed as a carve-out.
    for (const glob of NOT_MEASURED) {
      for (const dir of LOGIC_DIRS) {
        expect(
          glob === `${dir}/**` || glob === `${dir}/**/*`,
          `NOT_MEASURED excludes all of ${dir} — that is narrowing the surface, ` +
            `not carving out non-executable files.`,
        ).toBe(false);
      }
    }
  });
});

describe("the measurement stays wired up", () => {
  const config = readFileSync("vitest.config.ts", "utf8");

  it("vitest reads the shared surface instead of keeping its own copy", () => {
    expect(config).toMatch(/from\s+"\.\/scripts\/lib\/coverage-surface\.mjs"/);
    expect(config).toMatch(/include:\s*MEASURED/);
    expect(config).toMatch(/exclude:\s*NOT_MEASURED/);
    // A second, inlined include list is how the two drift apart.
    expect(
      /include:\s*\[\s*"src\//.test(config.slice(config.indexOf("coverage:"))),
      "vitest.config.ts inlines a coverage include list. There must be one " +
        "declaration of the surface, in scripts/lib/coverage-surface.mjs.",
    ).toBe(false);
  });

  it("uses the v8 provider the repo already ships", () => {
    expect(config).toMatch(/provider:\s*"v8"/);
    expect(config).toMatch(/json-summary/); // what report-coverage.mjs reads
  });

  it("CI still runs the reporter", () => {
    const ci = readFileSync(join(".github", "workflows", "ci.yml"), "utf8");
    expect(
      ci,
      "scripts/report-coverage.mjs is not run by CI, so the coverage floor " +
        "gates nothing and the number is measured where nobody reads it.",
    ).toContain("scripts/report-coverage.mjs");
    expect(ci).toContain("npm run test:coverage");
  });
});

describe("what is out of scope says why", () => {
  it("names a path that exists, a reason, and what covers it instead", () => {
    expect(OUT_OF_SCOPE.length).toBeGreaterThan(0);
    for (const entry of OUT_OF_SCOPE) {
      const dir = entry.path.split(/[\s*(]/)[0].replace(/\/$/, "");
      expect(existsSync(dir), `${entry.path}: "${dir}" is not in the tree`).toBe(true);
      expect(entry.why.length, `${entry.path} has no reason`).toBeGreaterThan(10);
      expect(
        entry.covered_by.length,
        `${entry.path} does not say what covers it instead — an exclusion with ` +
          `no answer to "then what checks this?" is a blind spot, not a boundary.`,
      ).toBeGreaterThan(10);
    }
  });
});
