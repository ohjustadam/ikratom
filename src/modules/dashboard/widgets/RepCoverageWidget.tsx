import { createClient } from "@/lib/supabase/server";
import { hasUserRequestedCoverage } from "@/modules/local-reps/actions";
import { normalizeLocality } from "@/lib/locality";
import { classifyUsPlace } from "@/lib/place-classify";
import { RequestCoverageButton } from "./RequestCoverageButton";
import { ParishCoverageBanner, ParishRequestBanner } from "./ParishCoverageBanners";

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
  // When the user hasn't filled in city/state yet, show a "Pull your
  // local reps — finish your profile first" CTA that links to /account.
  // This doubles the chance new users complete their profile (paired
  // with the profile_completion banner) and explicitly tells them WHY
  // we need the address: to surface their local reps.
  if (!userState || !userCity) {
    return (
      <section className="rounded-xl border border-amber-700/30 bg-amber-950/10 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-amber-300">
              Pull your local reps onto your dashboard
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Add your address (street + city + state + ZIP) and we&apos;ll auto-match
              you to your federal, state, and local representatives. One-click email
              + call from your war room afterwards.
            </p>
            <div className="mt-3">
              <a
                href="/account"
                className="inline-block rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                Complete profile →
              </a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Profile.city is the raw geocoder output (e.g. "Midwest City"). Legislator
  // rows are written through normalizeLocality which appends ", <STATE>"
  // (e.g. "Midwest City, OK"). The widget previously compared raw to
  // normalized and never matched. Normalize the user's city + county here
  // to canonical form before the lookup.
  const cityCanonical = normalizeLocality(userCity, userState);
  const countyCanonical = userCounty ? normalizeLocality(userCounty, userState) : null;

  const supabase = await createClient();
  // PostgREST .or() uses `,` as the OR separator at the top level — but
  // our canonical localities CONTAIN commas (e.g. "Midwest City, OK").
  // The value MUST be wrapped in double quotes to escape the comma;
  // without quoting, the parser splits "Midwest City, OK" into two
  // broken sub-conditions and never matches anything (this was the
  // bug that kept the banner visible after locality matched).
  const localityFilter = countyCanonical
    ? `locality.eq."${cityCanonical}",locality.eq."${countyCanonical}"`
    : `locality.eq."${cityCanonical}"`;
  const { count: localCount } = await supabase
    .from("legislators")
    .select("id", { count: "exact", head: true })
    .eq("state", userState)
    .eq("active", true)
    .in("level", ["municipal", "county"])
    .or(localityFilter);

  if ((localCount ?? 0) > 0) {
    // Already covered — nothing to do.
    return null;
  }

  // Unincorporated-place path. A resident whose city is a CDP / unincorporated
  // community (e.g. Poydras, LA) has NO municipal government — their local
  // government is the parent county/parish. Offering a municipal "Request
  // coverage" is a dead end (it auto-rejects, PR #806). We reach for this only
  // when there's no county on file yet: the Census geocoder fills county from a
  // full street address, so a resident with a county already gets matched
  // above, and this stays off the hot path for everyone else. Keyless Wikidata,
  // in-process cached; any "unknown" / network error falls through to the
  // municipal flow below, so the worst case is the prior behavior.
  if (!countyCanonical) {
    const cls = await classifyUsPlace(userState, userCity);
    if (cls.kind === "unincorporated" && cls.parentAdmin) {
      const parishCanonical = normalizeLocality(cls.parentAdmin, userState);
      if (parishCanonical) {
        const { count: parishCount } = await supabase
          .from("legislators")
          .select("id", { count: "exact", head: true })
          .eq("state", userState)
          .eq("active", true)
          .eq("level", "county")
          .eq("locality", parishCanonical);

        if ((parishCount ?? 0) > 0) {
          return (
            <ParishCoverageBanner state={userState} city={userCity} parish={cls.parentAdmin} />
          );
        }

        const countyRequested = await hasUserRequestedCoverage({
          locality: cls.parentAdmin,
          state: userState,
          level: "county",
        });
        return (
          <ParishRequestBanner
            state={userState}
            city={userCity}
            parish={cls.parentAdmin}
            requested={countyRequested}
          />
        );
      }
    }
  }

  // Have we asked already?
  const cityRequested = await hasUserRequestedCoverage({
    locality: userCity,
    state: userState,
    level: "municipal",
  });

  return (
    <section className="rounded-xl border border-amber-700/30 bg-amber-950/10 p-4">
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
