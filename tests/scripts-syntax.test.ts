import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Every .mjs under scripts/ must be syntactically valid.
 *
 * WHY THIS EXISTS: on 2026-08-19 (#867) a doc comment in
 * scripts/check-vercel-usage.mjs was "improved" to include a literal
 * every-N-hours cron expression. Those two characters close a block comment,
 * so the rest of the file became syntax errors and the hosting watchdog --
 * the job that exists to notice the site is in trouble -- could no longer
 * start. It shipped through a fully green CI run because nothing type-checks
 * or bundles scripts/: they are invoked by GitHub Actions as standalone
 * processes, and that cron step is continue-on-error, so it failed silently.
 *
 * A parse check is the cheapest possible floor under that whole class of bug.
 */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith(".mjs") || entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = collect("scripts");

describe("scripts/ syntax", () => {
  it("finds scripts to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every script parses", async () => {
    const broken: string[] = [];
    const queue = [...files];
    const workers = Array.from({ length: 16 }, async () => {
      for (let f = queue.pop(); f; f = queue.pop()) {
        try {
          await run(process.execPath, ["--check", f]);
        } catch (err) {
          broken.push(`${f}: ${String((err as { stderr?: string }).stderr ?? err).split("\n")[1] ?? ""}`);
        }
      }
    });
    await Promise.all(workers);
    expect(broken).toEqual([]);
  }, 120_000);
});
