/**
 * Auto-queue local-rep coverage requests when a user saves their
 * address into a city/county that we don't have coverage for yet.
 *
 * Owner directive 2026-05-16: "all existing users should have it,
 * future users will automate and they will automatically have them
 * visible." Today's reality (per audit): 4 of 9 current users have
 * no local matches because their locality isn't in our 62-locality
 * coverage set. The admin has to manually accept AI suggestions to
 * populate new localities.
 *
 * This helper closes the user-facing automation gap: every address
 * save now creates a coverage request automatically (idempotent) so
 * the admin queue at /admin/local-rep-requests reflects real demand
 * — admin can batch-process all incoming localities in one sweep
 * instead of waiting for individual users to click "Request coverage."
 *
 * NOT a full automation (that needs a cron + AI auto-accept of high-
 * confidence suggestions). This is the pragmatic minimum that gets
 * existing users into the queue + makes future signups self-serve.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { normalizeLocality } from "./locality";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Fire-and-forget: check if the user's city / county already has any
 * municipal / county local reps; if not, upsert a coverage request.
 * Never throws.
 */
export async function autoRequestLocalCoverageIfMissing(input: {
  userId: string;
  city: string | null;
  county: string | null;
  state: string | null;
}): Promise<void> {
  try {
    const { userId, state } = input;
    if (!state || !/^[A-Z]{2}$/.test(state)) return;

    const sb = admin();

    // Check municipal coverage for the city
    const cityLocality = input.city ? normalizeLocality(input.city, state) : null;
    if (cityLocality) {
      const { count } = await sb
        .from("legislators")
        .select("id", { count: "exact", head: true })
        .eq("level", "municipal")
        .eq("active", true)
        .eq("locality", cityLocality);
      if ((count ?? 0) === 0) {
        await sb.from("local_rep_requests").upsert(
          {
            user_id: userId,
            state,
            locality: cityLocality,
            level: "municipal",
            status: "pending",
          },
          { onConflict: "user_id,state,locality,level" },
        );
      }
    }

    // Same for county
    const countyLocality = input.county ? normalizeLocality(input.county, state) : null;
    if (countyLocality) {
      const { count } = await sb
        .from("legislators")
        .select("id", { count: "exact", head: true })
        .eq("level", "county")
        .eq("active", true)
        .eq("locality", countyLocality);
      if ((count ?? 0) === 0) {
        await sb.from("local_rep_requests").upsert(
          {
            user_id: userId,
            state,
            locality: countyLocality,
            level: "county",
            status: "pending",
          },
          { onConflict: "user_id,state,locality,level" },
        );
      }
    }
  } catch (e) {
    // Best-effort — never block the address save. Log for diagnosis.
    console.warn("[local-reps-auto-request] non-fatal:", (e as Error).message);
  }
}
