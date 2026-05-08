import { createClient } from "@/lib/supabase/server";
import { hasUserRequestedCoverage } from "@/modules/local-reps/actions";
import { RequestCoverageButton } from "./RequestCoverageButton";

/**
 * Cockpit widget that surfaces "we don't have your local reps yet —
 * request coverage" when the user has city/state but no local
 * legislators are in our DB for their area.
 *
 * Hides itself when:
 *   - user has no city/state (profile incomplete — handled by the
 *     profile_completion banner widget instead)
 *   - we already have local legislators for their city
 *   - the user has already requested coverage (we surface a quiet
 *     "waiting for review" status instead of the CTA)
 */
export async function RepCoverageWidget({
  userState,
  userCity,
  userCounty,
}: {
  userState: string | null;
  userCity: string | null;
  userCounty: string | null;
}) {
  if (!userState || !userCity) return null;

  const supabase = await createClient();
  // Check whether we have ANY local legislators in the user's locality
  const { count: localCount } = await supabase
    .from("legislators")
    .select("id", { count: "exact", head: true })
    .eq("state", userState)
    .in("level", ["municipal", "county"])
    .or(`locality.eq.${userCity}${userCounty ? `,locality.eq.${userCounty}` : ""}`);

  if ((localCount ?? 0) > 0) {
    // Already covered — nothing to do.
    return null;
  }

  // Have we asked already?
  const cityRequested = await hasUserRequestedCoverage({
    locality: userCity,
    state: userState,
    level: "municipal",
  });

  return (
    <section className="rounded-lg border border-amber-700/30 bg-amber-950/10 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-amber-300">
            Local reps not yet in {userCity}, {userState}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            iKratom has your federal + state legislators, but we don&apos;t have your
            city council / county officials yet. Request coverage and we&apos;ll
            research your area and add them — you&apos;ll get a notification when
            they appear here.
          </p>
          <div className="mt-3">
            {cityRequested ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-900/40 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300">
                ✓ Requested — admin will review
              </span>
            ) : (
              <RequestCoverageButton
                state={userState}
                locality={userCity}
                level="municipal"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
