/**
 * isr-no-cookies.test.ts — a cached-on-first-visit page must never read the
 * viewer's cookies or headers.
 *
 * WHY (2026-10-05): /bills/[id] exports generateStaticParams + revalidate (ISR)
 * while two of its server children called createClient()/getCachedClaims().
 * `next dev` renders that happily; a production build refuses mid-render with
 * DYNAMIC_SERVER_USAGE, and Netlify answered 500 for EVERY bill page from at
 * least 2026-09-26 until it was found on 2026-10-05. Nothing in CI noticed.
 *
 * This scans every route that opts into ISR (generateStaticParams) and the
 * server components it imports from its own folder, and fails on the calls
 * that read the request. Per-viewer data belongs in a client component that
 * fetches an /api route (see bills/[id]/YourRepDecidingThisBill.tsx).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = "src/app";
const VIEWER_READS = /\b(cookies|headers)\(\)|await createClient\(\)|getCachedClaims\(|getCachedAuthProfile\(|getCachedUser\(|readLocale\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

const isClient = (src: string) => /^\s*["']use client["']/.test(src);

function localServerImports(pageFile: string, src: string): string[] {
  const dir = path.dirname(pageFile);
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["']\.\/([A-Za-z0-9_-]+)["']/g)) {
    for (const ext of [".tsx", ".ts"]) {
      const f = path.join(dir, m[1] + ext);
      if (fs.existsSync(f) && !isClient(fs.readFileSync(f, "utf8"))) out.push(f);
    }
  }
  return out;
}

const isrPages = walk(APP).filter((f) => /export\s+(async\s+)?function\s+generateStaticParams/.test(fs.readFileSync(f, "utf8")));

describe("ISR pages never read the viewer's request", () => {
  it("finds the ISR routes (guards against a scan that silently matches nothing)", () => {
    const rel = isrPages.map((f) => f.replace(/\\/g, "/"));
    expect(rel).toContain("src/app/bills/[id]/page.tsx");
    expect(rel).toContain("src/app/legislators/[id]/page.tsx");
    expect(isrPages.length).toBeGreaterThanOrEqual(4);
  });

  it("no ISR page or its local server components read cookies/headers/auth", () => {
    const offenders: string[] = [];
    for (const page of isrPages) {
      const src = fs.readFileSync(page, "utf8");
      for (const f of [page, ...localServerImports(page, src)]) {
        const body = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        if (VIEWER_READS.test(body)) offenders.push(`${f.replace(/\\/g, "/")} (ISR via ${path.dirname(page).replace(/\\/g, "/")})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
