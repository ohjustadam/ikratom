import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { siteConfig } from "../src/config/site.config";

/**
 * security.txt must point at the real site and at an address that is read.
 *
 * WHY (2026-11-25). The file shipped on the old Vercel host: its Canonical and
 * Policy lines named ikratom.vercel.app (a paused spare), its Contact was
 * security@ikratom.org (only hello@, info@ and support@ forward; anything else
 * falls into the catch-all and is dropped), and the Policy page did not exist.
 * A researcher who followed it reached nobody.
 *
 * The file is read by tools as well as people, so it is held to its own facts:
 * same host as siteConfig.url (so a host move never strands it: the domain
 * stays), the one support address, a Policy page that is a real route, and an
 * Expires date that parses. It does NOT assert that Expires is in the future:
 * a date-driven check turns every unrelated CI run red on the day it lapses.
 * Renewal is noted in docs/RUNBOOK_host_move.md.
 */
const txt = readFileSync(join(__dirname, "..", "public", ".well-known", "security.txt"), "utf8");
const field = (name: string) => txt.match(new RegExp(`^${name}:\\s*(.+)$`, "mi"))?.[1]?.trim();

describe("public/.well-known/security.txt", () => {
  it("names the support address, which forwards", () => {
    expect(field("Contact")).toBe(`mailto:${siteConfig.links.support}`);
  });

  it("points Canonical and Policy at the real site, not a spare host", () => {
    const host = new URL(siteConfig.url).host;
    expect(new URL(field("Canonical")!).host).toBe(host);
    expect(new URL(field("Policy")!).host).toBe(host);
    expect(txt).not.toMatch(/vercel\.app|netlify\.app/i);
  });

  it("has a Policy page that exists", () => {
    const path = new URL(field("Policy")!).pathname; // /security
    expect(existsSync(join(__dirname, "..", "src", "app", path, "page.tsx"))).toBe(true);
  });

  it("has an Expires date that parses", () => {
    expect(Number.isNaN(Date.parse(field("Expires")!))).toBe(false);
  });
});

describe("the public /security page", () => {
  const page = readFileSync(join(__dirname, "..", "src", "app", "security", "page.tsx"), "utf8");

  it("shows the support address from config, not a hand-typed one", () => {
    expect(page).toContain("siteConfig.links.support");
    expect(page).not.toMatch(/security@ikratom\.org/);
  });

  it("says what we protect, not how (no defense vendor or mechanism named)", () => {
    for (const word of [/cloudflare/i, /turnstile/i, /rate.?limit/i, /\bWAF\b/, /\bRLS\b/, /row.level/i, /supabase/i, /netlify/i]) {
      expect(page).not.toMatch(word);
    }
  });
});
