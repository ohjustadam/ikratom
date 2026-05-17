import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export const metadata = {
  title: "Where kratom is banned — every state, county, and city tracking",
  description: "Comprehensive list of US jurisdictions banning kratom: 6 states, 12+ counties, 30+ cities. Updated as bans are enacted or repealed.",
};
export const dynamic = "force-dynamic";

/**
 * /banned — the comprehensive ban tracker.
 *
 * Owner directive: 'make an easy to read banned places list and/or
 * quick page. this will include all cities, counties and states.'
 *
 * Pulls from public.bills filtered to:
 *   kratom_relevance='anti' AND (status='enacted' OR status='passed_chamber')
 *   AND active=true
 *
 * Three sections:
 *   1. Banned states (scope=state, status=enacted)
 *   2. Imminent state bans (scope=state, status=passed_chamber)
 *      — surfaces TN HB 1649 (effective 2026-07-01 if signed)
 *   3. Banned counties + cities (scope=county|municipal, status=enacted)
 *      grouped by state
 *
 * Each row links to the bill detail page (where stakeholders, sponsors,
 * action plans, and the intel-tip form live).
 */
type BanRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  status: string | null;
  scope: string | null;
  locality: string | null;
  effective_date: string | null;
  last_action_at: string | null;
  source_url: string | null;
  opposition_summary_md: string | null;
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "D.C.",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

export default async function BannedPage() {
  const sb = await createClient();
  const { data } = await sb
    .from("bills")
    .select("id, state, bill_number, title, status, scope, locality, effective_date, last_action_at, source_url, opposition_summary_md")
    .eq("kratom_relevance", "anti")
    .eq("active", true)
    .in("status", ["enacted", "passed_chamber"])
    .range(0, 9999);
  const rows = (data ?? []) as BanRow[];

  // Bucket
  // For state-level rows, we ONLY count entries with editorial takeback intel
  // (opposition_summary_md is not null). This is our source of truth for "is
  // this an actual full kratom ban" vs "did this state pass any anti-kratom
  // legislation." Without this filter, 7-OH-only bans, age regs, KCPA bills,
  // and misclassified non-kratom rows all show up as "banning states" — which
  // is misleading. The 6 historical banning states + TN imminent are all
  // editorially curated with opposition_summary_md populated.
  const enactedStates = rows.filter(r => r.scope === "state" && r.status === "enacted" && r.opposition_summary_md);
  const imminentStates = rows.filter(r => r.scope === "state" && r.status === "passed_chamber" && r.opposition_summary_md);
  const enactedCounties = rows.filter(r => r.scope === "county" && r.status === "enacted");
  const enactedCities = rows.filter(r => r.scope === "municipal" && r.status === "enacted");

  // Group locals by state
  const localsByState = new Map<string, { counties: BanRow[]; cities: BanRow[] }>();
  for (const r of [...enactedCounties, ...enactedCities]) {
    if (!localsByState.has(r.state)) localsByState.set(r.state, { counties: [], cities: [] });
    const bucket = localsByState.get(r.state)!;
    if (r.scope === "county") bucket.counties.push(r);
    else bucket.cities.push(r);
  }
  const localStatesOrdered = [...localsByState.entries()].sort((a, b) => {
    const aTotal = a[1].counties.length + a[1].cities.length;
    const bTotal = b[1].counties.length + b[1].cities.length;
    return bTotal - aTotal;
  });

  const totalLocal = enactedCounties.length + enactedCities.length;
  const allBanStates = new Set([
    ...enactedStates.map(r => r.state),
    ...localsByState.keys(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">🚫 Banned tracker</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Where kratom is illegal in the United States</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Every state, county, and city where kratom is currently banned, plus state bans that are imminent. Each entry links to the underlying bill detail page where you&apos;ll find sponsors, stakeholders to contact, and a form to submit local intel. <strong className="text-zinc-200">Going forward: every new local ordinance triggers a tracked bill row automatically</strong> (via the hourly extractor + body watchlist). If something&apos;s missing, the intel-tip form on any bill page is the fastest way to surface it.
          </p>
        </div>
        <PageShareWithAttribution
          path="/banned"
          title="Where kratom is illegal in the US"
          summary="Every state, county, and city banning kratom — with imminent bans + repeal paths."
        />
      </header>
      <div className="mt-4 mb-6">
        <Link
          href="/takeback"
          className="inline-block rounded-md border border-amber-700/50 bg-amber-950/15 px-4 py-2 text-sm font-semibold text-amber-200 hover:border-amber-400"
        >
          🎯 See the takeback plan for every banned state →
        </Link>
      </div>

      {/* Top-line stats */}
      <section className="mb-8 grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Stat label="Banning states" value={enactedStates.length.toString()} tone="red" />
        <Stat label="Imminent state bans" value={imminentStates.length.toString()} tone={imminentStates.length > 0 ? "amber" : "neutral"} />
        <Stat label="Banning counties" value={enactedCounties.length.toString()} tone="red" />
        <Stat label="Banning cities" value={enactedCities.length.toString()} tone="red" />
      </section>

      {/* Imminent state bans pinned at top — actionable */}
      {imminentStates.length > 0 && (
        <section className="mb-8 rounded-lg border-2 border-amber-600/60 bg-amber-950/25 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
            🚨 Imminent statewide bans ({imminentStates.length})
          </h2>
          <p className="mt-1 text-[11px] text-amber-200/80">
            These bills have passed at least one chamber and are awaiting final action. The fight is not over.
          </p>
          <ul className="mt-3 space-y-2">
            {imminentStates.map(r => (
              <li key={r.id}>
                <Link href={`/bills/${r.id}`} className="block rounded border border-amber-700/40 bg-zinc-950/40 p-3 hover:border-amber-500">
                  <div className="flex flex-wrap items-baseline gap-2 text-[12px]">
                    <span className="font-mono font-semibold text-zinc-200">{r.state} · {r.bill_number}</span>
                    {r.effective_date && (
                      <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                        effective {new Date(r.effective_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {r.title && <p className="mt-1 text-sm font-medium text-zinc-100">{r.title}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Banning states */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Banned states ({enactedStates.length})
        </h2>
        {enactedStates.length === 0 ? (
          <p className="text-zinc-500">None — yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {[...enactedStates].sort((a, b) => a.state.localeCompare(b.state)).map(r => (
              <li key={r.id}>
                <Link href={`/bills/${r.id}`} className="block rounded border border-red-800/40 bg-zinc-950/40 p-3 hover:border-red-500">
                  <p className="font-semibold text-zinc-100">
                    <span className="font-mono text-red-300">{r.state}</span> {STATE_NAMES[r.state] ?? r.state}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">{r.bill_number}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Banning locals — grouped by state */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Banned counties + cities ({totalLocal} across {localStatesOrdered.length} states)
        </h2>
        <p className="mb-4 text-[11px] text-zinc-500">
          These jurisdictions have local-level bans on kratom sale, distribution, or possession — even where the surrounding state is legal. Mississippi has by far the most concentrated local-ban activity in the US.
        </p>
        <div className="space-y-4">
          {localStatesOrdered.map(([state, { counties, cities }]) => (
            <div key={state} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-zinc-100">
                  <span className="font-mono text-zinc-400">{state}</span> {STATE_NAMES[state] ?? state}
                </h3>
                <span className="text-[11px] text-zinc-500">
                  {counties.length} {counties.length === 1 ? "county" : "counties"} · {cities.length} {cities.length === 1 ? "city" : "cities"}
                </span>
              </div>
              {counties.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Counties</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {counties.map(r => (
                      <li key={r.id}>
                        <Link href={`/bills/${r.id}`} className="inline-block rounded-full border border-red-800/40 bg-red-950/15 px-2.5 py-0.5 text-[11px] text-zinc-300 hover:border-red-500 hover:text-zinc-100">
                          {r.locality?.replace(/,\s*[A-Z]{2}$/, "") ?? r.bill_number}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cities.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Cities</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {cities.map(r => (
                      <li key={r.id}>
                        <Link href={`/bills/${r.id}`} className="inline-block rounded-full border border-zinc-700 bg-zinc-950/40 px-2.5 py-0.5 text-[11px] text-zinc-400 hover:border-emerald-500 hover:text-zinc-200">
                          {r.locality?.replace(/,\s*[A-Z]{2}$/, "") ?? r.bill_number}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-400">
        <p className="font-semibold text-zinc-200">Why this matters even if you don&apos;t live in a banned jurisdiction</p>
        <p className="mt-1">
          Every local ban becomes precedent the AKA&apos;s opponents shop to the next county. {STATE_NAMES["MS"]}&apos;s 11-county + 25-city pattern started as one small county and spread. The Suffolk County NY resolution currently in committee was modeled in part on Mississippi precedent. If you can spot a friend in any of these jurisdictions, point them at us — they can subscribe to the bill page for status pings + submit local intel.
        </p>
        <p className="mt-2 text-zinc-500">
          Source for state-level designations: bills marked status=enacted in our DB. Source for local bans: editorial seed from public news + AKA state-action tracker + kratomlords.com legality map. Verify exact ordinance citations from city/county code search before citing publicly.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "red" | "amber" | "neutral" }) {
  const cls = tone === "red"
    ? "border-red-700/50 bg-red-950/20"
    : tone === "amber"
    ? "border-amber-700/50 bg-amber-950/20"
    : "border-zinc-800 bg-zinc-950/40";
  const valCls = tone === "red" ? "text-red-200" : tone === "amber" ? "text-amber-200" : "text-zinc-100";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${valCls}`}>{value}</p>
    </div>
  );
}
