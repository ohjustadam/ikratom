/**
 * report-coverage.mjs — turn "we have lots of tests" into a number.
 *
 * WHY: the repo has ~1300 tests and no measurement of what they reach. That
 * made "is this covered?" a matter of opinion, and opinion loses to whoever
 * spoke last. @vitest/coverage-v8 was already installed and had never run.
 *
 * This reads the json-summary vitest writes, reports line coverage over the
 * surface declared in scripts/lib/coverage-surface.mjs, lists the modules no
 * test touches at all, and compares both against a committed baseline.
 *
 * IT BLOCKS ON ONE THING ONLY: coverage falling more than TOLERANCE_PP below
 * the baseline. That catches a deleted suite or a large slab of untested
 * logic — the regressions worth a red check. It does NOT block on a single new
 * untested module, because on a codebase this size that happens in ordinary
 * work, and a gate that fires during ordinary work gets deleted. Those are
 * warnings, which is the honest weight for them.
 *
 * Usage:
 *   npm run coverage             # run the suite instrumented, then this
 *   npm run coverage:baseline    # re-record tests/coverage-baseline.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MEASURED, OUT_OF_SCOPE } from "./lib/coverage-surface.mjs";

const ROOT = process.cwd();
const SUMMARY = join(ROOT, "coverage", "coverage-summary.json");
const BASELINE = join(ROOT, "tests", "coverage-baseline.json");

/**
 * How far coverage may fall before the check goes red. One percentage point of
 * the logic layer is a couple of hundred lines — big enough that ordinary work
 * does not trip it, small enough that a dropped test file does.
 */
const TOLERANCE_PP = 1.0;

/**
 * How many zero-coverage modules to name. The list is the whole point, but an
 * 800-line CI log goes unread; the biggest ones are where to start.
 */
const NAME_AT_MOST = 15;

const inCI = !!process.env.GITHUB_ACTIONS;
const write = process.argv.includes("--write");

if (!existsSync(SUMMARY)) {
  console.error(
    "No coverage summary at " + relative(ROOT, SUMMARY) + ".\n" +
      "Run `npm run coverage` — it runs the suite instrumented and then this reporter.",
  );
  process.exit(1);
}

const summary = JSON.parse(readFileSync(SUMMARY, "utf8"));

/** Per-file rows, keyed by repo-relative path with forward slashes. */
const files = Object.entries(summary)
  .filter(([k]) => k !== "total")
  .map(([abs, m]) => ({
    path: relative(ROOT, abs).split(sep).join("/"),
    lines: m.lines?.total ?? 0,
    covered: m.lines?.covered ?? 0,
  }))
  // A file of nothing but types or re-exports has no executable lines; it is
  // neither covered nor uncovered, so counting it either way is a lie.
  .filter((f) => f.lines > 0);

const linesTotal = files.reduce((n, f) => n + f.lines, 0);
const linesCovered = files.reduce((n, f) => n + f.covered, 0);
const pct = linesTotal ? Number(((linesCovered / linesTotal) * 100).toFixed(2)) : 0;

const untested = files.filter((f) => f.covered === 0).sort((a, b) => b.lines - a.lines);

/**
 * Whether the DB-backed suites could run. tests/rate-limit.test.ts is
 * `describe.skipIf(!HAS_DB)`, so a machine with .env.local measures MORE code
 * than CI does — and a baseline recorded there is one CI can never meet, which
 * would make the floor permanently red for a reason that has nothing to do
 * with tests. Recording it means the mismatch is reported instead of guessed
 * at. See scripts/report-safety-coverage.mjs for the same gap from the other
 * side.
 */
const dbEnv = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const current = {
  surface: MEASURED,
  db_env: dbEnv,
  files_measured: files.length,
  lines_total: linesTotal,
  lines_covered: linesCovered,
  lines_pct: pct,
  files_untested: untested.length,
};

// ── report ────────────────────────────────────────────────────────────────
const out = [];
const say = (s = "") => out.push(s);

say("── Coverage of the logic layer ────────────────────────────────────────");
say("  " + pct + "% of lines  (" + linesCovered.toLocaleString() + " of " + linesTotal.toLocaleString() + ")");
say("  " + files.length + " modules measured · " + untested.length + " of them never loaded by any test");
say();
say("  Measured surface:");
for (const g of MEASURED) say("    " + g);
say();
say("  Outside the measured surface (and what covers it instead):");
for (const s of OUT_OF_SCOPE) {
  say("    " + s.path);
  say("      why:     " + s.why);
  say("      covered: " + s.covered_by);
}

if (untested.length) {
  say();
  const more = untested.length > NAME_AT_MOST ? ", " + (untested.length - NAME_AT_MOST) + " more not shown" : "";
  say("  Largest modules at 0% — no test loads these at all" + more + ":");
  for (const f of untested.slice(0, NAME_AT_MOST)) {
    say("    " + String(f.lines).padStart(5) + " lines  " + f.path);
  }
}

// ── baseline ──────────────────────────────────────────────────────────────
let exitCode = 0;
let headline = "Logic-layer coverage " + pct + "% (" + untested.length + " modules at 0%)";

if (write) {
  const body = {
    _comment:
      "Recorded coverage of the surface declared in scripts/lib/coverage-surface.mjs. " +
      "Regenerate with `npm run coverage:baseline`. scripts/report-coverage.mjs fails " +
      "CI if lines_pct falls more than " + TOLERANCE_PP + "pp below this, and " +
      "tests/coverage-surface.test.ts fails if `surface` stops matching the " +
      "declaration — so the number cannot be raised by measuring less.",
    measured_on: new Date().toISOString().slice(0, 10),
    ...current,
  };
  writeFileSync(BASELINE, JSON.stringify(body, null, 2) + "\n");
  say();
  say("  ✓ baseline written to " + relative(ROOT, BASELINE));
} else if (!existsSync(BASELINE)) {
  say();
  say("  ⚠ no baseline at " + relative(ROOT, BASELINE) + " — run `npm run coverage:baseline` to record one.");
} else {
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  const delta = Number((pct - base.lines_pct).toFixed(2));

  if (base.db_env !== dbEnv) {
    say();
    say(
      "  ⚠ measured under different conditions than the baseline: DB-backed suites " +
        (dbEnv ? "CAN" : "cannot") + " run here, baseline recorded with them " +
        (base.db_env ? "able" : "unable") + " to run. Compare the numbers with that in mind; " +
        "CI has no database credentials, so CI's reading is the one the floor is for.",
    );
  }
  say();
  say("  Baseline " + base.lines_pct + "% recorded " + base.measured_on + " · now " + pct + "% (" + (delta >= 0 ? "+" : "") + delta + "pp)");

  if (delta < -TOLERANCE_PP) {
    headline =
      "Coverage fell " + Math.abs(delta) + "pp to " + pct + "% (baseline " + base.lines_pct +
      "%, tolerance " + TOLERANCE_PP + "pp). A suite was probably removed, or a large slab " +
      "of untested logic added.";
    say("  ✗ " + headline);
    exitCode = 1;
  } else if (delta < 0) {
    say("  ~ down " + Math.abs(delta) + "pp, inside the " + TOLERANCE_PP + "pp tolerance.");
  }

  if (untested.length > base.files_untested) {
    const grew = untested.length - base.files_untested;
    say(
      "  ⚠ " + grew + " more module" + (grew === 1 ? "" : "s") + " at 0% than the baseline " +
        "records (" + base.files_untested + " → " + untested.length + ").",
    );
    if (exitCode === 0) headline += " — " + grew + " newly untested";
  }

  if (delta > TOLERANCE_PP) {
    say("  ✓ up " + delta + "pp. Re-record with `npm run coverage:baseline` to hold the gain.");
  }
}

say("──────────────────────────────────────────────────────────────────────");

const report = out.join("\n");
console.log(report);

if (inCI) {
  const level = exitCode ? "error" : untested.length ? "warning" : "notice";
  console.log("::" + level + " title=Coverage::" + headline);
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    try {
      writeFileSync(
        stepSummary,
        "### Coverage of the logic layer\n\n" +
          "**" + pct + "%** of lines — " + linesCovered.toLocaleString() + " of " +
          linesTotal.toLocaleString() + " across " + files.length + " modules. **" +
          untested.length + "** " + (untested.length === 1 ? "is" : "are") +
          " never loaded by any test.\n\n" +
          "<details><summary>Full report</summary>\n\n```\n" + report + "\n```\n\n</details>\n",
        { flag: "a" },
      );
    } catch {
      // A missing or unwritable summary file must never fail the run.
    }
  }
}

process.exit(exitCode);
