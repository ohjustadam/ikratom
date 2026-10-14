import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A cached (ISR) page must not read the viewer: no cookies(), headers(),
 * auth.getUser(), admin/creator context, or the cookie-bound Supabase client.
 * In Next 16 such a read inside `export const revalidate = N` makes every
 * render fail. /research/[id] called getAdminContext() and returned 500 on
 * all 548 papers from 2026-09-08 until 2026-10-13 (found by a draft-vs-prod
 * diff, not by any alarm). Per-viewer bits belong in client components or
 * /api routes. Scans every page, so a new one is covered automatically.
 */
const APP = new URL("../src/app/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const VIEWER_READ = /\b(getAdminContext|getCreatorContext)\(|\bcookies\(\)|\bheaders\(\)|\.auth\.getUser\(|await createClient\(\)/;

const cached = pages(APP)
  .map((file) => ({ file, src: stripComments(readFileSync(file, "utf8")) }))
  .filter(({ src }) => /export const revalidate = [1-9]\d*/.test(src) && !/export const dynamic = "force-dynamic"/.test(src));

describe("cached pages never read the viewer", () => {
  it("found the cached pages to check", () => {
    expect(cached.length).toBeGreaterThan(15);
    expect(cached.some(({ file }) => file.replace(/\\/g, "/").endsWith("research/[id]/page.tsx"))).toBe(true);
  });

  it.each(cached.map(({ file, src }) => [file.replace(/\\/g, "/").split("/src/app/")[1], src]))("%s", (_name, src) => {
    expect(src).not.toMatch(VIEWER_READ);
  });

  it("the rule catches the call that broke /research/[id]", () => {
    expect("const adminCheck = await getAdminContext();").toMatch(VIEWER_READ);
    expect("const sb = await createClient();").toMatch(VIEWER_READ);
    expect("// mentions auth.getUser() in a comment").not.toMatch(new RegExp(stripComments("x") + "$^"));
  });
});
