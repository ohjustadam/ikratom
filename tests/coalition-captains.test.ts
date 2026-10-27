import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CHAMBERS, coverageSummary, coverageTier, districtLabel, isChamber, isDistrict } from "@/modules/coalitions/districts";

/**
 * District captains + the coverage map (B4 d, migration 0295). The map shows
 * counts only, never names. The live proof is tests/sql/coalition-captains.sql.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const map = read("src/app/coalitions/[slug]/Coverage.tsx");
const sql = read("supabase/migrations/0295_coalition_district_captains.sql");

describe("district helpers", () => {
  it("labels numbered and named districts", () => {
    expect(districtLabel("state_house", "12")).toBe("HD 12");
    expect(districtLabel("state_senate", "9")).toBe("SD 9");
    expect(districtLabel("us_house", "3")).toBe("CD 3");
    expect(districtLabel("state_house", "1st Middlesex")).toBe("1st Middlesex");
  });
  it("validates the chamber and district like the table", () => {
    for (const c of CHAMBERS) expect(sql).toContain(`'${c.key}'`);
    expect(isChamber("state_house")).toBe(true);
    expect(isChamber("governor")).toBe(false);
    expect(isDistrict("12")).toBe(true);
    expect(isDistrict(" ")).toBe(false);
    expect(isDistrict("x".repeat(81))).toBe(false);
  });
  it("shades tiles by count and sums coverage", () => {
    expect([0, 1, 2, 4, 5, 40].map(coverageTier)).toEqual([0, 1, 2, 2, 3, 3]);
    expect(coverageSummary([
      { district: "1", members: 0, has_captain: false },
      { district: "2", members: 3, has_captain: true },
      { district: "3", members: 1, has_captain: false },
    ])).toEqual({ total: 3, withMembers: 2, withCaptain: 1 });
  });
});

describe("the coverage map is counts only", () => {
  it("the RPC returns district, count and a flag, never a user", () => {
    expect(sql).toMatch(/returns table \(district text, members integer, has_captain boolean\)/);
    expect(sql).toMatch(/public\.is_coalition_member\(p_coalition_id\) or public\.is_admin\(auth\.uid\(\)\)/);
    expect(sql).toMatch(/revoke all on function public\.coalition_district_coverage\(uuid, text\) from public, anon;/);
  });
  it("tiles render the count and a star, no handle", () => {
    const tiles = map.slice(map.indexOf("<ul aria-label"), map.indexOf("</ul>"));
    expect(tiles).toMatch(/\{r\.members\}/);
    expect(tiles).not.toMatch(/handle|user_id/);
    expect(map).not.toMatch(/full_name|\.email\b/);
  });
  it("captains must be members and only organizers assign them", () => {
    expect(sql).toMatch(/foreign key \(coalition_id, user_id\) references public\.coalition_members\(coalition_id, user_id\) on delete cascade/);
    expect(sql).toMatch(/with check \(assigned_by = auth\.uid\(\) and public\.is_coalition_admin\(coalition_id\)\)/);
    expect(sql).toMatch(/grant select, insert, update, delete on public\.coalition_district_captains to authenticated/);
  });
});
