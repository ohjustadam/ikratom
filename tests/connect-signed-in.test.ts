/**
 * /connect never offers "Join free" to a signed-in member (PJ, 2026-11-11: he
 * tapped it, landed on the sign-in page, and signed in again thinking he had
 * to). The page stays static: the browser decides who is looking.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { viewerLooksSignedIn } from "../src/lib/chrome-cookies";
import { connectHeroLinks } from "../src/app/connect/hero-links";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("src/app/connect/page.tsx");
const hero = read("src/app/connect/ConnectHeroActions.tsx");

describe("connectHeroLinks", () => {
  it("a member leads with Find a group and is never sent to sign up", () => {
    const links = connectHeroLinks(true);
    expect(links[0]).toEqual({ href: "/coalitions", label: "Find a group", primary: true });
    expect(links.some((l) => l.href === "/signup" || l.href === "/login")).toBe(false);
    expect(links.some((l) => /join/i.test(l.label))).toBe(false);
  });

  it("a visitor still gets Join free first, then Find a group", () => {
    const links = connectHeroLinks(false);
    expect(links.map((l) => l.href)).toEqual(["/signup", "/coalitions"]);
    expect(links[0]).toMatchObject({ label: "Join free (1 minute)", primary: true });
  });
});

describe("viewerLooksSignedIn", () => {
  it("trusts the session cookie until /api/me answers", () => {
    expect(viewerLooksSignedIn({ loading: true, userId: null }, true)).toBe(true);
    expect(viewerLooksSignedIn({ loading: true, userId: null }, false)).toBe(false);
  });

  it("then trusts /api/me, so an expired cookie reads as signed out", () => {
    expect(viewerLooksSignedIn({ loading: false, userId: "u1" }, true)).toBe(true);
    expect(viewerLooksSignedIn({ loading: false, userId: null }, true)).toBe(false);
    expect(viewerLooksSignedIn({ loading: false, userId: undefined }, false)).toBe(false);
  });
});

describe("the page stays static and cheap", () => {
  it("reads no cookies or headers on the server", () => {
    expect(page).not.toMatch(/from "next\/headers"/);
    expect(page).not.toMatch(/cookies\(\)|headers\(\)|getCachedAuthProfile|createClient/);
    expect(page).not.toMatch(/dynamic\s*=\s*"force-dynamic"/);
  });

  it("hands the hero buttons to the browser, and the page itself no longer links to sign-up", () => {
    expect(page).toMatch(/<ConnectHeroActions \/>/);
    expect(page).not.toMatch(/href="\/signup"/);
    expect(page).not.toMatch(/Join free/);
    expect(hero).toMatch(/^"use client";/);
    // The build-time HTML is the visitor's version, and no extra server call is made.
    expect(hero).toMatch(/const authCookieAtBuild = \(\) => false;/);
    expect(hero).not.toMatch(/fetch\(/);
  });
});
