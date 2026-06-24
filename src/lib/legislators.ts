import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLocality } from "./locality";

export type Legislator = {
  id: string;
  state: string;
  role: string;
  district: string | null;
  full_name: string;
  party: string | null;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website: string | null;
  portrait_url?: string | null; // headshot (R2-cached or source CDN); null -> initials
  // Local-officials fields (nullable for state/federal)
  level?: string | null;     // 'federal' | 'state' | 'county' | 'municipal'
  locality?: string | null;  // 'Austin, TX' | 'Travis County, TX'
  body?: string | null;      // 'Austin City Council'
  title?: string | null;     // 'Mayor' | 'Council Member, District 4'
};

export type UserCivicProfile = {
  state: string | null;
  congressional_district: string | null;
  state_senate_district: string | null;
  state_house_district: string | null;
  city?: string | null;
  county?: string | null;
};

/**
 * Find the specific legislators that represent this user, based on their
 * state + district numbers (set by the Civic Info lookup on profile save).
 *
 * Returns up to 6: 2 US senators (state-wide), 1 US rep, 1 state senator,
 * 1 state rep — depending on what's matched in the legislators table.
 */
export async function getUserLegislators(
  supabase: SupabaseClient,
  profile: UserCivicProfile
): Promise<Legislator[]> {
  if (!profile.state) return [];

  const { data: stateLegs } = await supabase
    .from("legislators")
    .select("id,state,role,district,full_name,party,email,phone,office_address,website,portrait_url,level,locality,body,title")
    .eq("state", profile.state)
    .eq("active", true);

  if (!stateLegs) return [];

  const matches: Legislator[] = [];

  // Both US senators (state-wide — match all in role=us_senate)
  matches.push(...stateLegs.filter((l) => l.role === "us_senate"));

  // US House: match by district
  if (profile.congressional_district) {
    matches.push(
      ...stateLegs.filter(
        (l) => l.role === "us_house" && l.district === profile.congressional_district
      )
    );
  }

  // State senate: match by district
  if (profile.state_senate_district) {
    matches.push(
      ...stateLegs.filter(
        (l) => l.role === "state_senate" && l.district === profile.state_senate_district
      )
    );
  }

  // State house: match by district
  if (profile.state_house_district) {
    matches.push(
      ...stateLegs.filter(
        (l) => l.role === "state_house" && l.district === profile.state_house_district
      )
    );
  }

  // Local officials: match by locality string. We canonicalize the
  // user's city/county through normalizeLocality so casing variants
  // ("Dallas borough" vs "Dallas Borough") still match the canonical
  // form we save into legislators.locality. Without this, profile data
  // typed in lowercase silently misses every local rep — bit a user
  // (Cory Kilheeney) before 2026-05-17. Belt-and-suspenders: we ALSO
  // do case-insensitive fallback if the canonical form doesn't match
  // (handles legacy legislators rows that pre-date normalizeLocality).
  const localityMatches: string[] = [];
  if (profile.city) {
    const norm = normalizeLocality(profile.city, profile.state);
    if (norm) localityMatches.push(norm);
  }
  if (profile.county) {
    const norm = normalizeLocality(profile.county, profile.state);
    if (norm) localityMatches.push(norm);
  }
  const lowerSet = new Set(localityMatches.map((l) => l.toLowerCase()));
  for (const l of stateLegs) {
    if (l.level !== "municipal" && l.level !== "county") continue;
    if (!l.locality) continue;
    if (lowerSet.has(l.locality.toLowerCase())) matches.push(l);
  }

  return matches;
}

export const ROLE_LABEL: Record<string, string> = {
  us_senate: "U.S. Senate",
  us_house: "U.S. House",
  state_senate: "State Senate",
  state_house: "State House",
  mayor: "Mayor",
  city_council: "City Council",
  county_executive: "County Executive",
  county_commissioner: "County Commissioner",
  school_board: "School Board",
  other_local: "Other Local",
};

export const ROLE_SHORT: Record<string, string> = {
  us_senate: "US Sen.",
  us_house: "US Rep.",
  state_senate: "State Sen.",
  state_house: "State Rep.",
  mayor: "Mayor",
  city_council: "Council",
  county_executive: "Co. Exec.",
  county_commissioner: "Commissioner",
  school_board: "School Bd.",
  other_local: "Local",
};

export const LEVEL_LABEL: Record<string, string> = {
  federal: "Federal",
  state: "State",
  county: "County",
  municipal: "Municipal",
};

export const LOCAL_ROLES = [
  "mayor",
  "city_council",
  "county_executive",
  "county_commissioner",
  "school_board",
  "other_local",
] as const;
