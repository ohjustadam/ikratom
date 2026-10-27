/**
 * District captains + the coverage map (migration 0295): the pure half,
 * shared by the page, the server action and the tests.
 */

export const CHAMBERS = [
  { key: "state_house", label: "State House", short: "HD", profileColumn: "state_house_district" },
  { key: "state_senate", label: "State Senate", short: "SD", profileColumn: "state_senate_district" },
  { key: "us_house", label: "U.S. House", short: "CD", profileColumn: "congressional_district" },
] as const;
export type Chamber = (typeof CHAMBERS)[number]["key"];

export type CoverageRow = { district: string; members: number; has_captain: boolean };

export function isChamber(v: unknown): v is Chamber {
  return typeof v === "string" && CHAMBERS.some((c) => c.key === v);
}

export function chamberOf(v: unknown): (typeof CHAMBERS)[number] {
  return CHAMBERS.find((c) => c.key === v) ?? CHAMBERS[0];
}

/** "HD 12" for a numbered district, the name itself for a named one ("1st Middlesex"). */
export function districtLabel(chamber: Chamber, district: string): string {
  return /^\d+[A-Z]?$/i.test(district) ? `${chamberOf(chamber).short} ${district}` : district;
}

export function isDistrict(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= 80;
}

/** The tile shade for a member count. Counts only, never names. */
export function coverageTier(members: number): 0 | 1 | 2 | 3 {
  if (members <= 0) return 0;
  if (members === 1) return 1;
  if (members <= 4) return 2;
  return 3;
}

/** One line for the organizer: how much of the map the group covers. */
export function coverageSummary(rows: CoverageRow[]): { total: number; withMembers: number; withCaptain: number } {
  return {
    total: rows.length,
    withMembers: rows.filter((r) => r.members > 0).length,
    withCaptain: rows.filter((r) => r.has_captain).length,
  };
}
