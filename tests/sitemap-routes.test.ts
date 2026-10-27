/**
 * sitemap-routes.test.ts — the sitemap's route discovery (B6 c) and its guards.
 *
 * The manifest is generated from src/app (npm run docs:routes) because the
 * serverless bundle has no route tree at runtime. These tests are what keeps
 * that file honest, and what keeps auto-discovery from ever advertising a
 * private or live-render route. They scan the tree rather than list routes, so
 * a page added tomorrow is covered without anyone editing this file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanRoutes } from "../scripts/lib/route-manifest.mjs";
import manifest from "../src/lib/route-manifest.generated.json";
import {
  advertisableRoutes,
  isAdvertisable,
  NEVER_ADVERTISE,
  type ManifestRoute,
} from "../src/lib/sitemap-routes";

const tree = scanRoutes(process.cwd());

const route = (over: Partial<ManifestRoute>): ManifestRoute => ({
  route: "/thing",
  dynamic: false,
  forceDynamic: false,
  revalidate: null,
  usesSearchParams: false,
  loginGated: false,
  redirectOnly: false,
  ...over,
});

describe("route manifest", () => {
  it("matches the route tree (run `npm run docs:routes` when this fails)", () => {
    expect(manifest.routes).toEqual(tree);
  });

  it("is not vacuous: the scan finds the tree, its dynamic routes and its private areas", () => {
    expect(tree.length).toBeGreaterThan(100);
    expect(tree.some((r) => r.dynamic)).toBe(true);
    expect(tree.some((r) => r.route.startsWith("/admin"))).toBe(true);
    expect(tree.some((r) => r.forceDynamic)).toBe(true);
  });
});

describe("what the sitemap may advertise", () => {
  const ok = advertisableRoutes(tree);

  it("finds public pages nobody listed by hand, and is not vacuous", () => {
    expect(ok.length).toBeGreaterThan(10);
    expect(ok).toContain("/knowledge");
    expect(ok).toContain("/glossary");
  });

  it("never includes a private, dynamic, gated or live-render route", () => {
    const byRoute = new Map(tree.map((r) => [r.route, r]));
    for (const p of ok) {
      const r = byRoute.get(p)!;
      expect(r.dynamic, p).toBe(false);
      expect(r.forceDynamic, p).toBe(false);
      expect(r.usesSearchParams, p).toBe(false);
      expect(r.loginGated, p).toBe(false);
      expect(r.redirectOnly, p).toBe(false);
      expect(p === "/search", p).toBe(false);
      for (const bad of ["/admin", "/account", "/api", "/dashboard", "/messages", "/login", "/signup"]) {
        expect(p === bad || p.startsWith(bad + "/"), p).toBe(false);
      }
    }
  });

  it("rejects each disqualifier when injected", () => {
    expect(isAdvertisable(route({}))).toBe(true);
    expect(isAdvertisable(route({ dynamic: true }))).toBe(false);
    expect(isAdvertisable(route({ forceDynamic: true }))).toBe(false);
    expect(isAdvertisable(route({ usesSearchParams: true }))).toBe(false);
    expect(isAdvertisable(route({ loginGated: true }))).toBe(false);
    expect(isAdvertisable(route({ redirectOnly: true }))).toBe(false);
    for (const p of NEVER_ADVERTISE) {
      expect(isAdvertisable(route({ route: p })), p).toBe(false);
      expect(isAdvertisable(route({ route: `${p}/child` })), `${p}/child`).toBe(false);
    }
    // robots.txt already forbids this family; the sitemap must not contradict it.
    expect(isAdvertisable(route({ route: "/alerts/some-id" }))).toBe(false);
  });
});

describe("the hand-kept sitemap entries", () => {
  it("point at routes that exist", () => {
    const src = readFileSync(join(process.cwd(), "src/app/sitemap.ts"), "utf8");
    // Only literal paths: `${base}/x/y` followed directly by the closing backtick.
    const literal = [...src.matchAll(/`\$\{base\}(\/[A-Za-z0-9\-/]*)`/g)].map((m) => m[1]);
    expect(literal.length).toBeGreaterThan(20);
    const exists = new Set(tree.filter((r) => !r.dynamic).map((r) => r.route));
    const missing = literal.filter((p) => !exists.has(p));
    expect(missing).toEqual([]);
  });
});
