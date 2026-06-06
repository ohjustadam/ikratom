import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard against the class of bug that 500'd every server-action page re-render
 * (digest @E352): a `"use server"` file exported a non-function value
 * (UI_THEMES/UI_ACCENTS/UI_MODES const arrays in src/modules/ui/actions.ts).
 * Next.js requires `"use server"` modules to export ONLY async functions, and
 * because the offending module was pulled into the root layout's action graph,
 * every server action across the app 500'd on its post-action re-render.
 *
 * This test fails CI if any `"use server"` file exports a value that isn't an
 * async function — move such constants to a plain module and import them.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const useServerFiles = walk("src").filter((f) => {
  // Directive must be the first statement (allow a leading comment/whitespace).
  const head = readFileSync(f, "utf8").replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^["']use server["']/.test(head);
});

describe('"use server" files export only async functions', () => {
  it("has at least one use-server file to verify the scanner works", () => {
    expect(useServerFiles.length).toBeGreaterThan(0);
  });

  for (const file of useServerFiles) {
    it(`${file}`, () => {
      const offenders: string[] = [];
      for (const raw of readFileSync(file, "utf8").split("\n")) {
        const t = raw.trim();
        // `export type` / `export interface` are erased at build — always fine.
        if (/^export\s+(type|interface)\b/.test(t)) continue;
        // Value exports must be async functions.
        const valueExport = /^export\s+(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*(.+)$/.exec(t);
        if (valueExport && !/^async\b/.test(valueExport[1].trim())) {
          offenders.push(t.slice(0, 90));
        }
        // `export function` must be async.
        if (/^export\s+(?:default\s+)?function\b/.test(t) && !/\basync\s+function\b/.test(t)) {
          offenders.push(t.slice(0, 90));
        }
      }
      expect(
        offenders,
        `${file} exports non-async-function value(s) from a "use server" module — move them to a plain module:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});
