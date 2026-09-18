/**
 * coverage-surface.mjs — the ONE place that declares what "coverage" measures.
 *
 * WHY THIS FILE EXISTS. The repo runs ~1300 tests and nobody could say what
 * they cover. "Well tested" was a claim, not a reading, and the only coverage
 * statement anywhere — scripts/report-safety-coverage.mjs — speaks about
 * exactly two suites by inspecting env vars, not by measuring anything.
 * @vitest/coverage-v8 has been a devDependency since the repo's first commit
 * and had never been run.
 *
 * WHY NOT JUST `vitest --coverage` OVER src/. Because that number would be
 * noise. 410 of 816 source files are Next pages and route handlers under
 * src/app, and nothing in tests/ imports one; 130 more are .tsx components,
 * and the suite runs in `environment: "node"` with no DOM. A whole-tree figure
 * would read about 10%, and it would move mainly when someone adds a page —
 * i.e. it would change for reasons that have nothing to do with testing. A
 * metric that moves for the wrong reasons is worse than none, because people
 * start managing the metric.
 *
 * So the measured surface is the LOGIC LAYER: the code a unit test can reach
 * and should. Everything else is named in OUT_OF_SCOPE below with what does
 * cover it, so the boundary is stated rather than implied.
 *
 * THE ONLY WAY TO GAME THIS NUMBER IS TO SHRINK THE SURFACE, so the surface
 * lives here, in one exported array, and tests/coverage-surface.test.ts
 * asserts the file count it resolves to. Narrowing MEASURED to flatter the
 * percentage is then a visible line in a diff next to a failing test, which is
 * the same trick tests/egress-gate-wiring.test.ts plays on the workflow list.
 */

/**
 * The measured surface. Line coverage is reported for every file matching
 * these globs, tested or not — a file no test touches shows up at 0% rather
 * than not showing up at all, which is the difference between a coverage
 * number and a flattering one.
 */
export const MEASURED = [
  "src/lib/**/*.ts",
  "src/modules/**/*.ts",
  "scripts/lib/**/*.mjs",
];

/** Carve-outs inside MEASURED that carry no runtime behaviour to cover. */
export const NOT_MEASURED = [
  "**/*.d.ts",
  "**/__tests__/**",
  "src/**/*.tsx",
  // Mirrors of scripts/lib/*.mjs kept in sync by hand; covering both copies
  // of the same logic would double-count it.
  "scripts/lib/**/*.test.mjs",
];

/**
 * What is deliberately outside the measured surface, and what covers it
 * instead. Printed by scripts/report-coverage.mjs on every run so the number
 * never arrives without its boundary, and asserted by
 * tests/coverage-surface.test.ts so a path cannot be quietly moved out of
 * scope without saying why here.
 */
export const OUT_OF_SCOPE = [
  {
    path: "src/app/**",
    why: "Next pages and route handlers. No unit test imports one, so v8 would report ~0% forever and swamp the signal.",
    covered_by:
      "the Next.js build job, scripts/check-responsive.mjs under Playwright, and the per-page scan in tests/admin-surface-coverage.test.ts",
  },
  {
    path: "src/components/** and **/*.tsx",
    why: 'React components. The suite runs in `environment: "node"` with no DOM, so they cannot be rendered here.',
    covered_by: "the build, and the responsive guard against a real server",
  },
  {
    path: "scripts/*.mjs (top level)",
    why: "Cron entrypoints, invoked by GitHub Actions as standalone processes. They read env and talk to Supabase on import, so loading 190 of them to measure coverage would mean either mocking the whole platform or hitting production.",
    covered_by:
      "tests/scripts-syntax.test.ts (every file parses), tests/cron-pager-registry.test.ts (every writer is monitored), and their own scraper_runs telemetry",
  },
  {
    path: "supabase/migrations/**",
    why: "SQL, not JavaScript.",
    covered_by: "tests/rls.test.ts, which `verify` excludes — see scripts/report-safety-coverage.mjs",
  },
];
