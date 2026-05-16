"use server";

/**
 * Re-run the district lookup for a user's saved address.
 *
 * Owner directive 2026-05-16: friend (creamcook@gmail.com) had full
 * address saved but all three district fields were NULL — Census
 * geocoder didn't have the address indexed (known limitation for some
 * rural / unincorporated US addresses). The campaign page then
 * incorrectly showed "We need your address" with no recovery path.
 *
 * This action lets a signed-in user re-run the lookup on their saved
 * address. Returns:
 *   - { ok: true, ... }            — lookup succeeded, districts saved
 *   - { ok: false, error: 'no-match' } — address legit but Census doesn't
 *                                        have it; user should find their
 *                                        rep manually
 *   - { ok: false, error: 'no-address' } — profile has no street yet
 *   - { ok: false, error: '...' }  — network/other failure
 */

import { createClient } from "@/lib/supabase/server";
import { getDistrictsForAddress } from "@/lib/civic";
import { checkRateLimit } from "@/lib/rate-limit";

export type RetryDistrictsResult =
  | {
      ok: true;
      congressional_district: string | null;
      state_senate_district: string | null;
      state_house_district: string | null;
      city: string | null;
      county: string | null;
    }
  | { ok: false; error: "no-match" | "no-address" | "rate-limited" | "save-failed" | string };

export async function retryDistrictLookup(): Promise<RetryDistrictsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // 5 retries per user per hour is plenty — discourages someone running
  // the lookup in a loop hoping Census starts working.
  const allowed = await checkRateLimit(`retryDistricts:${user.id}`, 5, 60 * 60);
  if (!allowed) return { ok: false, error: "rate-limited" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("street, city, state, zip")
    .eq("id", user.id)
    .single();

  if (!profile?.street || !profile?.city || !profile?.state) {
    return { ok: false, error: "no-address" };
  }

  const districts = await getDistrictsForAddress({
    street: profile.street,
    city: profile.city,
    state: profile.state,
    zip: profile.zip ?? null,
  });

  const anyPopulated =
    districts.congressional_district ||
    districts.state_senate_district ||
    districts.state_house_district;
  if (!anyPopulated) {
    // The address is on file but Census doesn't have it. Don't write
    // null over null — caller can show the "find manually" path.
    return { ok: false, error: "no-match" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      // Don't overwrite city/county/etc — the user typed those.
      congressional_district: districts.congressional_district,
      state_senate_district: districts.state_senate_district,
      state_house_district: districts.state_house_district,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: "save-failed" };

  return {
    ok: true,
    congressional_district: districts.congressional_district,
    state_senate_district: districts.state_senate_district,
    state_house_district: districts.state_house_district,
    city: districts.city,
    county: districts.county,
  };
}
