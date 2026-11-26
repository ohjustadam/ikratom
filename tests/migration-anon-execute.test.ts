/**
 * A function granted only to `authenticated` must also be revoked from `anon`.
 *
 * `revoke all ... from public` does not do it: Supabase's default privileges
 * grant EXECUTE to anon by name. Four academy functions stayed callable
 * signed-out that way until 0337. This scans every migration from 0337 on.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const FROM = 337;

/** Names of functions a migration grants to members but leaves callable by anon. */
export function anonLeftOpen(sql: string): string[] {
  const s = sql.toLowerCase().replace(/--.*$/gm, "");
  const open = new Set<string>();
  const grants = s.matchAll(/grant\s+execute\s+on\s+function\s+(?:public\.)?([a-z0-9_]+)\s*(?:\([^)]*\))?\s+to\s+([^;]+);/g);
  for (const [, name, roles] of grants) {
    if (/\b(anon|public)\b/.test(roles)) continue;
    const anonGranted = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${name}\\b[^;]*\\bto\\b[^;]*\\banon\\b`).test(s);
    const anonRevoked = new RegExp(`revoke\\s+(?:all|execute)[^;]*\\bon\\s+function\\s+(?:public\\.)?${name}\\b[^;]*\\bfrom\\b[^;]*\\banon\\b`).test(s);
    if (!anonGranted && !anonRevoked) open.add(name);
  }
  return [...open];
}

const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= FROM);

describe("migrations revoke anon EXECUTE on member-only functions", () => {
  it("catches the pattern that left the academy functions open (0333)", () => {
    const f = readdirSync(DIR).find((x) => x.startsWith("0333_"))!;
    expect(anonLeftOpen(readFileSync(DIR + f, "utf8")).sort()).toEqual(
      ["academy_grade_answer", "academy_start_exam", "academy_submit_exam"],
    );
  });

  it("passes when anon is revoked or deliberately granted", () => {
    expect(anonLeftOpen("revoke all on function public.f(uuid) from public, anon;\ngrant execute on function public.f(uuid) to authenticated;")).toEqual([]);
    expect(anonLeftOpen("grant execute on function public.g() to anon, authenticated;")).toEqual([]);
  });

  it("scans at least the migration that fixed it", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s leaves no member-only function callable by anon", (f) => {
    expect(anonLeftOpen(readFileSync(DIR + f, "utf8"))).toEqual([]);
  });
});
