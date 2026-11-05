import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Owner, 2026-11-03: /pitch is business planning, for the owner's eyes only
// (not admins, never public). Every page gates itself: a layout check doesn't
// protect a page, because Next renders the two separately (see require-owner.ts).
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
  );

describe("/pitch is owner-only", () => {
  it("requireOwner 404s anyone who is not the owner", () => {
    expect(read("src/app/pitch/require-owner.ts")).toMatch(/!ctx\.ok \|\| !ctx\.isOwner\) notFound\(\)/);
  });

  it("every page checks first, and its metadata gives nothing away", () => {
    const pages = walk(join(ROOT, "src/app/pitch")).filter((f) => /page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThanOrEqual(4); // the scan really ran
    for (const f of pages) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/export default async function \w+\(\) \{\s+await requireOwner\(\);/);
      expect(src, f).toMatch(/title: "iKratom",/);
      expect(src, f).not.toMatch(/^\s*description:/m);
      expect(src, f).toMatch(/export const dynamic = "force-dynamic"/);
    }
  });

  it("no layout in the app is used as an access check", () => {
    const layouts = walk(join(ROOT, "src/app")).filter((f) => /layout\.tsx$/.test(f));
    expect(layouts.length).toBeGreaterThan(0);
    expect(layouts.filter((f) => /getAdminContext|getCreatorContext|notFound\(\)/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("nothing outside /pitch links to it", () => {
    const files = walk(join(ROOT, "src")).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(files.length).toBeGreaterThan(100); // the scan really ran
    const linking = files.filter((f) => !f.startsWith("src/app/pitch/") && /href=["'{`]+\/pitch/.test(read(f)));
    expect(linking).toEqual([]);
  });
});
