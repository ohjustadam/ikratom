/**
 * The getting-started guide (/how-it-works) only links to pages that exist.
 *
 * Rewritten 2026-11-03 because the old tour had drifted: its screenshots showed
 * a UI that no longer existed and it described features that had changed. The
 * guide now links straight to each tool, so a renamed or removed route is the
 * way it would rot next. This reads every href in the guide's files and checks
 * it against the route manifest (npm run docs:routes).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import manifest from "../src/lib/route-manifest.generated.json";

const DIR = path.join(__dirname, "../src/app/how-it-works");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
const routes = (manifest.routes as { route: string }[]).map((r) => r.route);

/** "/states/[code]" matches "/states/OK"; static routes match exactly. */
function routeExists(href: string): boolean {
  const p = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  return routes.some((r) => {
    if (r === p) return true;
    const re = new RegExp(`^${r.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+")}$`);
    return re.test(p);
  });
}

const hrefs = new Set<string>();
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), "utf8");
  for (const m of src.matchAll(/href(?:=|:\s*)["'](\/[^"'#?]*)/g)) hrefs.add(m[1]);
}

describe("getting-started guide links", () => {
  it("finds the guide's links (the scan itself works)", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(hrefs.size).toBeGreaterThanOrEqual(20);
    expect(hrefs).toContain("/coalitions/new");
  });

  it.each([...hrefs])("%s is a real page", (href) => {
    expect(routeExists(href)).toBe(true);
  });

  it("would catch a dead link", () => {
    expect(routeExists("/no-such-page")).toBe(false);
  });
});
