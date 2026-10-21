import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildTicker } from "../src/lib/ticker";

const NOW = Date.parse("2026-10-21T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe("buildTicker", () => {
  const rows = {
    campaigns: [
      { slug: "alert-la-louisiana-adds", title: "Louisiana adds kratom substances to state's schedule I list", state: "LA", created_at: daysAgo(1) },
      { slug: "old-one", title: "An old campaign about kratom", state: "TX", created_at: daysAgo(40) },
    ],
    alerts: [
      { id: "a1", title: "Louisiana adds kratom substances to state's schedule I list", locality: "LA", severity: "alert", created_at: daysAgo(1) },
      { id: "a2", title: "FDA moves to schedule 7-OH nationwide", locality: "FED", severity: "critical", created_at: daysAgo(2) },
      { id: "a3", title: "Bismarck boil advisory, Minot bridge repairs", locality: "ND", severity: "alert", created_at: daysAgo(1) },
      { id: "a4", title: "Oneida County kratom ban signed into law", locality: "Oneida County, NY", severity: "alert", created_at: daysAgo(3) },
      { id: "a5", title: "Stale kratom story", locality: "OH", severity: "alert", created_at: daysAgo(30) },
    ],
    meetings: [
      { id: "m1", locality: "Portsmouth, RI", state: "RI", body_name: "Public panel on kratom (community event)", meeting_at: inDays(6) },
      { id: "m2", locality: "Past, TX", state: "TX", body_name: "Council", meeting_at: daysAgo(1) },
    ],
  };
  const items = buildTicker(rows, NOW);

  it("orders breaking first, then actions, meetings, other alerts", () => {
    expect(items.map((i) => i.kind)).toEqual(["breaking", "action", "meeting", "alert"]);
    expect(items[0]).toMatchObject({ label: "Breaking", text: "Federal: FDA moves to schedule 7-OH nationwide", href: "/alerts/a2" });
    expect(items[1]).toMatchObject({ label: "Take action", href: "/campaigns/alert-la-louisiana-adds" });
    expect(items[2].text).toMatch(/^Oct 27 · Portsmouth, RI: Public panel on kratom/);
  });

  it("shows an alert that spawned a campaign once, as the action", () => {
    expect(items.filter((i) => /Louisiana adds/.test(i.text))).toHaveLength(1);
  });

  it("drops off-topic, stale and past items", () => {
    const text = items.map((i) => i.text).join(" | ");
    expect(text).not.toMatch(/boil advisory|Stale kratom|old campaign|Past, TX/);
  });

  it("caps the crawl length", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, title: `Kratom item ${i}`, locality: "TX", severity: "alert", created_at: daysAgo(1) }));
    expect(buildTicker({ campaigns: [], alerts: many, meetings: [] }, NOW)).toHaveLength(14);
  });
});

describe("wiring", () => {
  const route = readFileSync(new URL("../src/app/api/ticker/route.ts", import.meta.url), "utf8");
  const comp = readFileSync(new URL("../src/components/IntelTicker.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("the endpoint is cached and cookie-free", () => {
    expect(route).toMatch(/export const dynamic = "force-static"/);
    expect(route).toMatch(/export const revalidate = 600/);
    expect(route).toMatch(/createAnonClient\(\)/);
    expect(route).not.toMatch(/cookies\(|headers\(|supabase\/server/);
  });

  it("only approved / active content is read", () => {
    expect(route).toMatch(/\.eq\("moderation_status", "approved"\)[\s\S]*\.eq\("moderation_status", "approved"\)/);
    expect(route).toMatch(/\.eq\("active", true\)/);
  });

  it("respects reduced motion and keeps the loop copy out of screen readers", () => {
    expect(comp).toMatch(/motion-safe:animate-ticker/);
    expect(comp).toMatch(/motion-reduce:overflow-x-auto/);
    expect(comp).toMatch(/<span aria-hidden className="flex gap-10 motion-reduce:hidden">/);
    expect(css).toMatch(/--animate-ticker: ticker/);
    expect(css).toMatch(/@keyframes ticker/);
  });

  it("is mounted in the sticky header, off admin and embeds", () => {
    expect(layout).toMatch(/<IntelTicker \/>\s*<\/header>/);
    expect(comp).toMatch(/startsWith\("\/embed"\)/);
    expect(comp).toMatch(/startsWith\("\/admin"\)/);
  });
});
