import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Donor intel — substance-policy-adjacent contributions",
  description: "Federal legislators ranked by substance-policy-adjacent donor industry contributions — pharma, alcohol, tobacco, hospital, addiction-treatment, cannabis, gaming. Where the conflict-of-interest money flows.",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type IndustryRow = {
  industry: string;
  label?: string;
  advocate_flag?: boolean;
  amount: number;
  count?: number;
};

type DonorRow = {
  legislator_id: string;
  total_receipts: number | null;
  cycle: number | null;
  top_industries: IndustryRow[] | null;
};

type LegislatorRow = {
  id: string;
  full_name: string;
  state: string;
  role: string;
  party: string | null;
  district: string | null;
};

type LeaderboardRow = {
  legislator: LegislatorRow;
  total_receipts: number;
  flagged_amount: number;
  flagged_industries: IndustryRow[];
  cycle: number | null;
};

const FLAGGED_INDUSTRY_LABELS: Record<string, string> = {
  pharma_biotech: "Pharma / biotech",
  alcohol: "Alcohol",
  tobacco_nicotine: "Tobacco / nicotine",
  hospital_health: "Hospital / health",
  addiction_treatment: "Addiction treatment",
  cannabis: "Cannabis",
  gaming_casino: "Gaming / casino",
};

/**
 * /intel/donations — substance-policy-adjacent donor leaderboard.
 *
 * Ranks every matched federal legislator by total contributions from
 * the seven substance-policy-adjacent industries we flag. The order
 * answers "who is most-bought by industries with a stake in kratom
 * policy outcomes?"
 *
 * Source: legislator_donors.top_industries, derived from FEC
 * schedule-A by-employer data by classify-donor-industries.mjs.
 * Federal-only (state legislators don't have OpenFEC profiles).
 */
export default async function DonationsIntelPage() {
  const sb = await createClient();

  // Pull every matched donor + the joined legislator. RLS allows
  // public read on both tables.
  const { data: donorsRaw } = await sb
    .from("legislator_donors")
    .select("legislator_id, total_receipts, cycle, top_industries")
    .eq("resolved_status", "matched");

  const donors = (donorsRaw ?? []) as DonorRow[];
  const legIds = donors.map((d) => d.legislator_id);

  const { data: legs } = await sb
    .from("legislators")
    .select("id, full_name, state, role, party, district")
    .in("id", legIds);
  const legById = new Map((legs ?? []).map((l) => [l.id, l as LegislatorRow]));

  // Build leaderboard rows: sum amounts across flagged industries.
  const rows: LeaderboardRow[] = [];
  for (const d of donors) {
    const leg = legById.get(d.legislator_id);
    if (!leg) continue;
    const industries = Array.isArray(d.top_industries) ? d.top_industries : [];
    const flagged = industries.filter((i) => i.advocate_flag);
    const flaggedAmount = flagged.reduce((sum, i) => sum + (i.amount || 0), 0);
    if (flaggedAmount < 1000) continue; // skip trace amounts
    rows.push({
      legislator: leg,
      total_receipts: d.total_receipts ?? 0,
      flagged_amount: flaggedAmount,
      flagged_industries: flagged.sort((a, b) => b.amount - a.amount),
      cycle: d.cycle,
    });
  }
  rows.sort((a, b) => b.flagged_amount - a.flagged_amount);

  // Aggregate totals across the whole corpus
  const totalFlagged = rows.reduce((sum, r) => sum + r.flagged_amount, 0);
  const byIndustryTotals = new Map<string, { amount: number; recipientCount: number }>();
  for (const r of rows) {
    for (const ind of r.flagged_industries) {
      const cur = byIndustryTotals.get(ind.industry) ?? { amount: 0, recipientCount: 0 };
      cur.amount += ind.amount;
      cur.recipientCount += 1;
      byIndustryTotals.set(ind.industry, cur);
    }
  }
  const industryTotalsSorted = [...byIndustryTotals.entries()].sort(
    (a, b) => b[1].amount - a[1].amount,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">
          ← Intel hub
        </Link>
      </div>

      <header className="mb-8">
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Donor intel
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Where the conflict-of-interest money flows
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Federal legislators ranked by total contributions from substance-policy-adjacent
          industries — pharma, alcohol, tobacco, hospital, addiction-treatment, cannabis, gaming.
          The kratom industry itself contributes essentially zero via FEC channels, but the industries
          that would BENEFIT from a kratom ban (or be threatened by kratom availability) show up here.
        </p>
        <p className="mt-2 max-w-3xl text-[11px] text-zinc-500">
          Source: FEC schedule-A by-employer data via OpenFEC, classified into industries by
          pattern matching. Sums exclude individual / self-employed / retired donations. Federal
          legislators only — state-level donor data is a 50-state effort still pending.
        </p>
      </header>

      {/* Industry-level totals — the big buckets */}
      {industryTotalsSorted.length > 0 && (
        <section className="mb-8 rounded-lg border border-amber-700/30 bg-amber-950/10 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            Industry totals · across {rows.length} federal legislators
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Aggregate contributions per substance-adjacent industry, summed across every flagged
            legislator. Total flagged: ${totalFlagged.toLocaleString()}.
          </p>
          <ul className="mt-3 space-y-1">
            {industryTotalsSorted.map(([ind, stats]) => (
              <li key={ind} className="flex flex-wrap items-baseline gap-x-2 rounded border border-red-700/30 bg-red-950/10 px-3 py-1.5 text-xs">
                <span className="text-[10px] font-bold text-red-300">⚠</span>
                <span className="font-semibold text-red-100">
                  {FLAGGED_INDUSTRY_LABELS[ind] ?? ind}
                </span>
                <span className="text-[10px] text-zinc-500">
                  to {stats.recipientCount} legislator{stats.recipientCount === 1 ? "" : "s"}
                </span>
                <span className="ml-auto font-mono tabular-nums text-amber-200">
                  ${stats.amount.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Leaderboard — top legislators by flagged $$ */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Top recipients · {rows.length} legislator{rows.length === 1 ? "" : "s"} with material flagged donations
        </h2>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
            No matched federal legislators with substance-adjacent industry contributions ≥ $1,000.
            The cron-driven donor sync + industry classifier may not have completed a full pass yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.slice(0, 100).map((r, i) => (
              <li key={r.legislator.id}>
                <Link
                  href={`/legislators/${r.legislator.id}/briefing`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-amber-500/60"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="text-zinc-500 font-mono">#{i + 1}</span>
                    <span className="text-sm font-semibold text-zinc-100">
                      {r.legislator.full_name}
                    </span>
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono uppercase text-[10px] text-zinc-400">
                      {r.legislator.role.replace(/_/g, " ")}
                    </span>
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      {r.legislator.state}
                    </span>
                    {r.legislator.party && (
                      <span className="text-[10px] text-zinc-500">{r.legislator.party}</span>
                    )}
                    {r.legislator.district && (
                      <span className="text-[10px] text-zinc-500">D{r.legislator.district}</span>
                    )}
                    <span className="ml-auto font-mono tabular-nums text-amber-300">
                      ${r.flagged_amount.toLocaleString()}
                      <span className="ml-1 text-[10px] text-zinc-500">
                        flagged · of ${r.total_receipts.toLocaleString()} total
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.flagged_industries.map((ind) => (
                      <span
                        key={ind.industry}
                        className="rounded border border-red-700/40 bg-red-950/20 px-2 py-0.5 text-[10px] text-red-100"
                      >
                        ⚠ {FLAGGED_INDUSTRY_LABELS[ind.industry] ?? ind.industry}{" "}
                        <span className="font-mono tabular-nums text-amber-200">
                          ${ind.amount.toLocaleString()}
                        </span>
                      </span>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-[10px] text-zinc-600">
        Industry classifications are heuristic (pattern match on employer names). The classifier
        catches well-known industry brands; one-off small donors with generic employer names show
        up as &ldquo;Individual / professional&rdquo; or &ldquo;Self-employed&rdquo; and are excluded from
        flagged totals. See <code className="rounded bg-zinc-900 px-1 py-0.5">scripts/classify-donor-industries.mjs</code> for the full pattern set.
      </p>
    </div>
  );
}
