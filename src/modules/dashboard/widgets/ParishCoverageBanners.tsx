import { RequestCoverageButton } from "./RequestCoverageButton";
import { AdoptCountyButton } from "./AdoptCountyButton";

/**
 * Banners for a resident whose city is an unincorporated community / CDP.
 *
 * Such a place has NO municipal government — its local government is the parent
 * county/parish. RepCoverageWidget renders one of these IN PLACE OF the
 * dead-end municipal "Request coverage" button (which auto-rejects for a CDP,
 * see PR #806 + suggest-officials.ts). Presentational only — the widget decides
 * which one based on whether the parish council is already in our DB.
 */

// The parish/county council is already in our DB. One click pins it to the
// resident's profile (adoptDerivedCounty) so it flows into every rep surface —
// dashboard "Your representatives" + /my-district — instead of a dead end.
export function ParishCoverageBanner({
  state,
  city,
  parish,
}: {
  state: string;
  city: string;
  parish: string;
}) {
  return (
    <section className="rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-emerald-300">
            Your local government is {parish}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {city} is an unincorporated community, so it has no city council of
            its own — you&apos;re represented by {parish}, and we already have
            those officials. Add them and they&apos;ll appear under your
            representatives here and on My District.
          </p>
          <div className="mt-3">
            <AdoptCountyButton state={state} county={parish} />
          </div>
        </div>
      </div>
    </section>
  );
}

// The parish/county is identified but not yet in our DB. Route the request to
// the COUNTY queue — a municipal request could never resolve for a CDP.
export function ParishRequestBanner({
  state,
  city,
  parish,
  requested,
}: {
  state: string;
  city: string;
  parish: string;
  requested: boolean;
}) {
  return (
    <section className="rounded-lg border border-amber-700/30 bg-amber-950/10 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-amber-300">
            {city} is represented by {parish}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {city} is an unincorporated community with no city council of its own
            — your local government is {parish}. We don&apos;t have those officials
            yet. Request coverage and we&apos;ll research the county and add them —
            you&apos;ll get a notification when they appear.
          </p>
          <div className="mt-3">
            {requested ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-900/40 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300">
                ✓ Requested — admin will review
              </span>
            ) : (
              <RequestCoverageButton state={state} locality={parish} level="county" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
