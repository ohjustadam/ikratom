import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Owner, 2026-11-03: /pitch is business planning, for the owner's eyes only
// (not admins, never public). The layout is the one gate for every page under it.
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
  );

describe("/pitch is owner-only", () => {
  it("the layout 404s anyone who is not the owner", () => {
    expect(read("src/app/pitch/layout.tsx")).toMatch(/!ctx\.ok \|\| !ctx\.isOwner\) notFound\(\)/);
  });

  it("nothing outside /pitch links to it", () => {
    const files = walk(join(ROOT, "src")).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(files.length).toBeGreaterThan(100); // the scan really ran
    const linking = files.filter((f) => !f.startsWith("src/app/pitch/") && /href=["'{`]+\/pitch/.test(read(f)));
    expect(linking).toEqual([]);
  });
});
