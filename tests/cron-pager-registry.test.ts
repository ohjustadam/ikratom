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
    "check-cron-staleness.mjs",
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
});
