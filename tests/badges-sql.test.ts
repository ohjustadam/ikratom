import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_BADGES } from "@/modules/badges/catalog";
import { coolingTargets } from "@/modules/campaigns/resend-cooldown";

// Mission patches are awarded in SQL (migration 0322) but named in TS. Keep them in step.
const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "0322_badges_awarded_and_email_changed_at.sql"), "utf8");
const rows = Array.from(sql.matchAll(/\('([a-z0-9_]+)',\s*'([^']+)',\s*'([^']+)',/g)).map((m) => ({ id: m[1], emoji: m[2], name: m[3] }));

describe("migration 0322 badge rules", () => {
  it("awards every catalog patch that has a rule (bipartisan_outreach has none yet)", () => {
    const awarded = new Set(rows.map((r) => r.id));
    const missing = ALL_BADGES.map((b) => b.id).filter((id) => id !== "bipartisan_outreach" && !awarded.has(id));
    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(missing).toEqual([]);
  });

  it("uses the catalog's names and emoji in the bell notification", () => {
    for (const r of rows) {
      const b = ALL_BADGES.find((x) => x.id === r.id);
      expect(b, r.id).toBeTruthy();
      expect(r.name).toBe(b!.name);
      expect(r.emoji).toBe(b!.emoji);
    }
  });
});

describe("coolingTargets (resend lock after an email fix, PJ 11-13)", () => {
  const sends = [
    { legislator_id: "fixed", sent_at: "2026-11-11T20:00:00Z" },
    { legislator_id: "same", sent_at: "2026-11-11T20:00:00Z" },
    { legislator_id: "fixed-before", sent_at: "2026-11-13T15:00:00Z" },
    { legislator_id: null, sent_at: "2026-11-11T20:00:00Z" },
  ];
  const changed = new Map<string, string | null>([
    ["fixed", "2026-11-12T05:59:59Z"],
    ["same", null],
    ["fixed-before", "2026-11-12T05:59:59Z"],
  ]);

  it("opens an official whose email changed after the send", () => {
    expect(coolingTargets(sends, changed).has("fixed")).toBe(false);
  });

  it("keeps the lock when nothing changed, or the send came after the fix", () => {
    const c = coolingTargets(sends, changed);
    expect(c.has("same")).toBe(true);
    expect(c.has("fixed-before")).toBe(true);
    expect(c.size).toBe(2);
  });

  it("an unknown official keeps the lock", () => {
    expect(coolingTargets([{ legislator_id: "x", sent_at: "2026-11-11T20:00:00Z" }], new Map()).has("x")).toBe(true);
  });
});
