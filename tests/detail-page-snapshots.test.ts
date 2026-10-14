import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * /bills/[id], /alerts/[id], /research/[id] and /news/[id] read through R2
 * snapshots (2026-10-13), so a page older than the stale cap (next.config
 * expireTime) re-renders from the last good copy when Supabase is failing,
 * instead of rendering empty sections. These pin that wiring.
 */
const read = (p: string) => readFileSync(new URL(`../src/app/${p}/page.tsx`, import.meta.url), "utf8");

const PAGES = [
  { path: "bills/[id]", kind: "bill-public", ttl: "900", load: "loadBillPublic" },
  { path: "alerts/[id]", kind: "alert-public", ttl: "0", load: "loadAlertPublic" },
  { path: "research/[id]", kind: "research-paper", ttl: "1800", load: "loadResearchPaper" },
  { path: "news/[id]", kind: "news-article", ttl: "900", load: "loadNewsArticle" },
];

describe.each(PAGES)("/$path", ({ path, kind, ttl, load }) => {
  const src = read(path);

  it("reads through publicSnapshot under unstable_cache", () => {
    expect(src).toMatch(new RegExp(`publicSnapshot<\\w+>\\("${kind}", "v1", id, ${ttl}, \\(\\) => ${load}\\(id\\)\\)`));
    expect(src).toMatch(/unstable_cache\(\s*\(id: string\) => publicSnapshot/);
  });

  it("throws on a failing database instead of rendering 'not found'", () => {
    const body = src.slice(src.indexOf(`async function ${load}`));
    expect(body).toMatch(/if \((\w+\.)?error[^)]*\) throw new Error/);
    // ...and a genuinely missing row returns null data, which is never stored.
    expect(body).toMatch(/return \{ data: (null|data \?\? null), cacheable: (false|true) \}/);
  });

  it("marks partial reads not cacheable", () => {
    expect(src).toMatch(/cacheable: /);
  });
});

it("bills: a missing row (PGRST116 from .single()) is not-found, not an outage", () => {
  const src = read("bills/[id]");
  expect(src).toMatch(/billRes\.error && billRes\.error\.code !== "PGRST116"\) throw/);
});

it("alerts: the R2 copy never stands in for a fresh read (emergency flushes publish at once)", () => {
  expect(read("alerts/[id]")).toMatch(/"alert-public", "v1", id, 0,/);
});
