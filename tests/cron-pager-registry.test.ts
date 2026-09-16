import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY } from "../scripts/lib/cron-pager-registry.mjs";

/**
 * Registry↔writer integrity guard (audit 2026-07-16).
 *
 * The self-pager (check-cron-staleness.mjs) can only alert on a source that
 * has written at least one scraper_runs row — a registered source that NO
 * script ever writes is a phantom: it fakes monitoring coverage forever
 * (grace-skipped as "never observed"). Three weekly phantoms + a mis-named
 * daily source shipped exactly this way. This test statically asserts every
 * REGISTRY source string appears as a quoted literal in some script/route,
 * so a rename/typo/removal on either side fails CI instead of silently
 * blinding the watchdog.
 */

// Sources whose writers legitimately live OUTSIDE this repo's scripts/src
// (or write the string via a variable). Every entry needs a justification.
const EXTERNAL_OR_DYNAMIC: Record<string, string> = {
  // Owner-box nightly chassis writes these via scripts in this repo, but a
  // few build the source string dynamically — verified writers 2026-07-16:
  // (add entries here ONLY with a named writer + reason)
};

function collectFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".archive" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

describe("cron pager registry ↔ writer integrity", () => {
  // EXCLUDE the registry/catalog files themselves — they contain every source
  // as a literal, which would make this test vacuously pass.
  const REGISTRY_FILES = [
    "cron-pager-registry.mjs",
    "cron-registry.ts",
    "cron-expectations.ts",
    // check-cron-staleness.mjs USED to be here, and the exclusion went stale on
    // 2026-07-16 when the registry was extracted out of it into
    // cron-pager-registry.mjs. It no longer inlines the source list — measured
    // 2026-09-16, it contains exactly ONE registry literal, its own
    // "check_cron_staleness", written as real scraper_runs telemetry. Excluding
    // it therefore hid a genuine writer rather than preventing a vacuous pass,
    // which is why registering the pager failed this test until now.
    "codebase-digest.json",
  ];
  const files = [
    ...collectFiles("scripts", [".mjs", ".js", ".cjs"]),
    ...collectFiles("src", [".ts", ".tsx"]),
  ].filter((f) => !REGISTRY_FILES.some((r) => f.endsWith(r)));
  // One big haystack — fine at this repo size, and far faster than per-file regex.
  const haystack = files.map((f) => readFileSync(f, "utf8")).join("\n");

  it("REGISTRY has a sane shape", () => {
    expect(Array.isArray(REGISTRY)).toBe(true);
    expect(REGISTRY.length).toBeGreaterThan(50);
    for (const e of REGISTRY) {
      expect(typeof e.source).toBe("string");
      expect(e.interval_hours).toBeGreaterThan(0);
    }
  });

  it("contains no duplicate sources", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of REGISTRY) {
      if (seen.has(e.source)) dupes.push(e.source);
      seen.add(e.source);
    }
    expect(dupes, `duplicate registry sources: ${dupes.join(", ")}`).toEqual([]);
  });

  it("every registered source has a writer in this repo (no phantoms)", () => {
    const phantoms: string[] = [];
    for (const e of REGISTRY) {
      if (EXTERNAL_OR_DYNAMIC[e.source]) continue;
      // A writer references the source as a quoted string literal.
      const found =
        haystack.includes(`"${e.source}"`) || haystack.includes(`'${e.source}'`) || haystack.includes("`" + e.source + "`");
      if (!found) phantoms.push(e.source);
    }
    expect(
      phantoms,
      `Registered sources with NO writer anywhere in scripts/ or src/ — either fix the source string, add telemetry to the script, or document in EXTERNAL_OR_DYNAMIC: ${phantoms.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The OTHER direction (added 2026-09-16).
   *
   * The phantom test above walks registry → writer: it catches an entry that
   * fakes coverage. It cannot catch the reverse, which is the more common
   * mistake: a scheduled script that writes real telemetry and was never added
   * to the registry. That source is genuinely unmonitored — it can die and stay
   * dead with nothing to say so, and the pager looks healthy the whole time.
   *
   * This found `egress_gate` and `check_cron_staleness` on the day it was
   * written — the load-shedder and the pager itself, i.e. the two pieces of
   * machinery that watch everything else were the two nothing watched.
   *
   * Cross-checked against live scraper_runs the same day: the DB showed exactly
   * these two as scheduled-and-unregistered, so this static scan agrees with
   * ground truth rather than approximating it.
   */
  it("every scheduled script's telemetry source is registered (no orphans)", () => {
    // PRECISION MATTERS MORE THAN REACH HERE. A first cut matched any `source:`
    // key and flagged 8 — six were false, because `election_dates.source`,
    // `bill_actions.source` and `legislators.portrait_source` are data-
    // provenance columns, not telemetry. A guard that cries wolf gets muted, so
    // only an actual scraper_runs write counts. Two shapes exist in this repo:
    // the shared runWithLogging helper, and a hand-rolled insert.
    const WRITE_PATTERNS = [
      // No /s flag: the tsconfig target predates es2018, and it is not needed —
      // the negated class [^}] already spans newlines on its own.
      /runWithLogging\(\s*\{[^}]*?source:\s*["'`]([a-z0-9_.-]+)["'`]/gi,
      /from\(\s*["'`]scraper_runs["'`]\s*\)[\s\S]{0,200}?source:\s*["'`]([a-z0-9_.-]+)["'`]/gi,
      /source:\s*["'`]([a-z0-9_.-]+)["'`][\s\S]{0,200}?from\(\s*["'`]scraper_runs["'`]/gi,
    ];
    const registered = new Set(REGISTRY.map((e) => e.source));
    const orphans = new Map<string, Set<string>>();
    let writesFound = 0;

    const wfDir = join(".github", "workflows");
    for (const f of readdirSync(wfDir)) {
      if (!f.endsWith(".yml")) continue;
      const wf = readFileSync(join(wfDir, f), "utf8");
      // Only SCHEDULED workflows. A manual-dispatch or push-triggered script is
      // run by a human who sees it fail; nobody is waiting on it silently.
      if (!/^\s*schedule:/m.test(wf)) continue;
      const scripts = new Set(
        [...wf.matchAll(/scripts\/([A-Za-z0-9_./-]+\.mjs)/g)].map((m) => m[1]),
      );
      for (const s of scripts) {
        let body: string;
        try {
          body = readFileSync(join("scripts", s), "utf8");
        } catch {
          continue; // step references a script that no longer exists — not this test's job
        }
        for (const re of WRITE_PATTERNS) {
          for (const m of body.matchAll(re)) {
            writesFound++;
            if (registered.has(m[1])) continue;
            if (!orphans.has(m[1])) orphans.set(m[1], new Set());
            orphans.get(m[1])!.add(`${f} → scripts/${s}`);
          }
        }
      }
    }

    // Guards against a silently-broken scan, same reasoning as the freeze test:
    // if the workflow glob or the write patterns stop matching, every assertion
    // below passes vacuously and this file becomes decoration.
    expect(writesFound, "found no scraper_runs writes at all — the scan is broken").toBeGreaterThan(50);

    const detail = [...orphans]
      .sort()
      .map(([src, where]) => `  ${src}\n      ${[...where].join("\n      ")}`)
      .join("\n");
    expect(
      [...orphans.keys()].sort(),
      orphans.size
        ? `\n\n${orphans.size} scheduled source(s) write telemetry but are NOT in the pager\n`
          + `registry, so they can die silently. Add each to scripts/lib/cron-pager-registry.mjs\n`
          + `with a realistic interval_hours (the pager fires at 3x it):\n\n${detail}\n`
        : "",
    ).toEqual([]);
  });
});
