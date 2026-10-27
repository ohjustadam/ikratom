import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GROUP_BADGES, groupBadge } from "@/modules/coalitions/home";

/**
 * Group badge + opt-in leaderboard (B4 g, migration 0294). The badge is a
 * collective count; the leaderboard is off by default and @handle only. The
 * live proof is tests/sql/coalition-leaderboard.sql (`npm run test:db`).
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const board = read("src/app/coalitions/[slug]/Leaderboard.tsx");
const sql = read("supabase/migrations/0294_coalition_leaderboard.sql");

describe("groupBadge", () => {
  it("has no badge below the first tier", () => {
    expect(groupBadge(0)).toBeNull();
    expect(groupBadge(9)).toBeNull();
  });
  it("climbs the tiers and names the next one", () => {
    expect(groupBadge(10)).toEqual({ icon: "🌱", name: "Seedling", next: { name: "Leaf", at: 50 } });
    expect(groupBadge(249)?.name).toBe("Leaf");
    expect(groupBadge(250)?.name).toBe("Grove");
    expect(groupBadge(5000)).toEqual({ icon: "🌳", name: "Forest", next: null });
  });
  it("tiers ascend", () => {
    for (let i = 1; i < GROUP_BADGES.length; i++) expect(GROUP_BADGES[i].min).toBeGreaterThan(GROUP_BADGES[i - 1].min);
  });
});

describe("the leaderboard", () => {
  it("is off by default and lists only members who opted in", () => {
    expect(sql).toMatch(/add column if not exists leaderboard_opt_in_at timestamptz;/);
    expect(sql).not.toMatch(/leaderboard_opt_in_at timestamptz[^;]*default/);
    expect(sql).toMatch(/and m\.leaderboard_opt_in_at is not null/);
    expect(sql).toMatch(/where coalition_id = p_coalition_id and user_id = auth\.uid\(\);/);
  });
  it("serves members only, never anon", () => {
    expect(sql).toMatch(/public\.is_coalition_member\(p_coalition_id\) or public\.is_admin\(auth\.uid\(\)\)/);
    expect(sql).toMatch(/revoke all on function public\.coalition_leaderboard\(uuid\) from public, anon;/);
  });
  it("renders @handle only", () => {
    expect(board).toMatch(/publicHandle\(p\)/);
    expect(board).toMatch(/get_public_profiles/);
    expect(board).not.toMatch(/full_name|\.email\b/);
  });
});
