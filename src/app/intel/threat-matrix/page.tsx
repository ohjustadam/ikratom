import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  assessThreat,
  TIER_META,
  TIER_ORDER,
  type ThreatAssessment,
  type ThreatTier,
} from "@/lib/legislator-threat-score";
import type { Stance } from "@/lib/legislator-action-plan";

export const metadata = {
  title: "Threat matrix — who to target, who to flip",
  description: "Every legislator ranked by composite threat + vulnerability score. Pulls stance, sponsorships, committee leverage, donor industries, and personal stock trades into one targeting view.",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type LegislatorRow = {
  id: string;
  full_name: string;
  state: string;
  role: string;
  district: string | null;
  party: string | null;
};

type ScoredRow = {
  legislator: LegislatorRow;
  assessment: ThreatAssessment;
  signals: {
    stance: Stance;
    anti_sponsor_count: number;
    pro_sponsor_count: number;
    cosponsor_count: number;
    has_anti_sponsorship: boolean;
    has_pro_sponsorship: boolean;
    is_chair_of_kratom_relevant: boolean;
    is_member_of_kratom_relevant: boolean;
    bills_in_committees: number;
    kratom_adjacent_trade_count: number | null;
    flagged_industry_total: number;
    cluster_count: number;
  };
};

/**
 * /intel/threat-matrix — the checkmate intel view.
 *
 * Single ranked targeting list across every legislator. Pulls every
 * signal we have (stance, sponsorships, committees, currently-deciding
 * bills, donor industries, STOCK Act personal trades) and feeds them
 * through the composite threat / vulnerability scorer in
 * src/lib/legislator-threat-score.ts.
 *
 * The page groups by tier and lets advocates filter by state. Each
 * row links to the full legislator briefing for drilling in.
 *
 * Why this matters: before this page, an advocate had to bounce
 * across /intel/donations, /legislators, /states/[code]/briefing, and
 * per-legislator briefings to triage who to focus on. This collapses
 * all that into ONE ranked list with one-line rationales.
 */
export default async function ThreatMatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; tier?: string }>;
}) {
  const sp = await searchParams;
  const stateFilter = sp.state?.toUpperCase();
  const tierFilter = sp.tier as ThreatTier | undefined;

  const sb = await createClient();

  // ── Bulk-pull all signals we need.
  //
  // Supabase PostgREST caps responses at ~1000 rows per query by
  // default. The full active-legislator set is ~8,500 and committees
  // is ~32k, both beyond that cap. We paginate via .range() chunks of
  // 1000. Filter-tagged tables (stances=466, sponsors=154, donors=408,
  // trades<300) fit in a single response.
  async function fetchAllLegislators(): Promise<LegislatorRow[]> {
    const all: LegislatorRow[] = [];
    const CHUNK = 1000;
    for (let i = 0; i < 20; i++) {
      let q = sb
        .from("legislators")
        .select("id, full_name, state, role, district, party")
        .eq("active", true)
        .order("id", { ascending: true })
        .range(i * CHUNK, (i + 1) * CHUNK - 1);
      if (stateFilter) q = q.eq("state", stateFilter);
      const { data } = await q;
      const rows = (data ?? []) as LegislatorRow[];
      all.push(...rows);
      if (rows.length < CHUNK) break;
    }
    return all;
  }
  // Only kratom-relevant committees matter for the threat matrix.
  // Server-side filter cuts the row count from ~32k → ~6k and lets us
  // skip the per-leg substring match for bills-in-committee (which was
  // crude anyway). The "currently deciding" signal still works because
  // active kratom bills are virtually always assigned to kratom-relevant
  // committees (Health / Judiciary / Public Safety / etc.).
  async function fetchKratomCommittees(): Promise<Array<{
    legislator_id: string;
    committee_name: string;
    role: string;
    is_kratom_relevant: boolean | null;
  }>> {
    const all: Array<{
      legislator_id: string;
      committee_name: string;
      role: string;
      is_kratom_relevant: boolean | null;
    }> = [];
    const CHUNK = 1000;
    for (let i = 0; i < 10; i++) {
      const { data } = await sb
        .from("legislator_committees")
        .select("legislator_id, committee_name, role, is_kratom_relevant")
        .eq("is_kratom_relevant", true)
        .order("legislator_id", { ascending: true })
        .range(i * CHUNK, (i + 1) * CHUNK - 1);
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < CHUNK) break;
    }
    return all;
  }

  const [
    legs,
    stancesRaw,
    sponsorsRaw,
    committeesAll,
    activeBillsInCommitteeRaw,
    donorsRaw,
    tradesRaw,
  ] = await Promise.all([
    fetchAllLegislators(),
    sb.from("legislator_kratom_stance").select("legislator_id, stance"),
    sb
      .from("bill_sponsors")
      .select("legislator_id, classification, bill_id, bills!inner(kratom_relevance, state, active, current_committee_name)")
      .eq("bills.active", true),
    fetchKratomCommittees(),
    sb
      .from("bills")
      .select("id, state, current_committee_name, kratom_relevance")
      .eq("active", true)
      .not("current_committee_name", "is", null),
    sb
      .from("legislator_donors")
      .select("legislator_id, top_industries, kratom_relevant")
      .eq("resolved_status", "matched"),
    sb
      .from("federal_personal_trades")
      .select("legislator_id")
      .eq("is_kratom_adjacent", true),
  ]);

  // Cluster involvement per legislator — join bill_sponsors (primary)
  // to bill_cluster_members. Shows how many distinct coordinated
  // operations each legislator is running bills for. Multi-cluster
  // operators are the most damning signal in the network map.
  const clusterMembersRaw = await sb
    .from("bill_cluster_members")
    .select("bill_id, bill_clusters!inner(slug)");

  // Build a synthetic raw wrapper so existing code that reads
  // `committeesRaw.data` works without further refactor.
  const committeesRaw = { data: committeesAll };

  // ── Build lookup maps from each batch query
  const stanceByLeg = new Map<string, Stance>();
  for (const r of (stancesRaw.data ?? []) as Array<{ legislator_id: string; stance: Stance }>) {
    stanceByLeg.set(r.legislator_id, r.stance);
  }

  type SponsorshipAgg = {
    primary_count: number;
    cosponsor_count: number;
    has_anti: boolean;
    has_pro: boolean;
    anti_primary_count: number;
    pro_primary_count: number;
  };
  const sponsorshipByLeg = new Map<string, SponsorshipAgg>();
  for (const s of (sponsorsRaw.data ?? []) as Array<{
    legislator_id: string;
    classification: string;
    bills: { kratom_relevance: string | null; state: string } | Array<{ kratom_relevance: string | null; state: string }> | null;
  }>) {
    const b = Array.isArray(s.bills) ? s.bills[0] : s.bills;
    if (!b) continue;
    const agg = sponsorshipByLeg.get(s.legislator_id) ?? {
      primary_count: 0, cosponsor_count: 0,
      has_anti: false, has_pro: false,
      anti_primary_count: 0, pro_primary_count: 0,
    };
    if (s.classification === "primary") {
      agg.primary_count++;
      if (b.kratom_relevance === "anti") agg.anti_primary_count++;
      if (b.kratom_relevance === "pro") agg.pro_primary_count++;
    } else {
      agg.cosponsor_count++;
    }
    if (b.kratom_relevance === "anti") agg.has_anti = true;
    if (b.kratom_relevance === "pro") agg.has_pro = true;
    sponsorshipByLeg.set(s.legislator_id, agg);
  }

  type CommitteeAgg = { is_chair_relevant: boolean; is_member_relevant: boolean };
  const committeeByLeg = new Map<string, CommitteeAgg>();
  for (const c of (committeesRaw.data ?? []) as Array<{
    legislator_id: string;
    committee_name: string;
    role: string;
    is_kratom_relevant: boolean | null;
  }>) {
    if (!c.is_kratom_relevant) continue;
    const agg = committeeByLeg.get(c.legislator_id) ?? { is_chair_relevant: false, is_member_relevant: false };
    agg.is_member_relevant = true;
    if (c.role === "chair") agg.is_chair_relevant = true;
    committeeByLeg.set(c.legislator_id, agg);
  }

  // Bills currently sitting in committee, grouped by state. The
  // join logic for committee-matching is intentionally lightweight
  // (substring case-insensitive) since the threat score only needs
  // a count, not perfect attribution.
  type BillInCmt = { state: string; committee: string };
  const billsInCmtByState = new Map<string, BillInCmt[]>();
  for (const b of (activeBillsInCommitteeRaw.data ?? []) as Array<{
    id: string;
    state: string;
    current_committee_name: string | null;
  }>) {
    if (!b.current_committee_name) continue;
    if (!billsInCmtByState.has(b.state)) billsInCmtByState.set(b.state, []);
    billsInCmtByState.get(b.state)!.push({
      state: b.state,
      committee: b.current_committee_name.toLowerCase(),
    });
  }
  const billsInCmtCountByLeg = new Map<string, number>();
  // Resolve per-legislator bill counts by walking committees once.
  for (const c of (committeesRaw.data ?? []) as Array<{
    legislator_id: string;
    committee_name: string;
  }>) {
    const leg = legs.find((l) => l.id === c.legislator_id);
    if (!leg) continue;
    const billsInState = billsInCmtByState.get(leg.state) ?? [];
    const myCmt = c.committee_name.toLowerCase();
    for (const b of billsInState) {
      // crude substring match — better than nothing without per-state committee map
      if (b.committee.includes(myCmt) || myCmt.includes(b.committee)) {
        billsInCmtCountByLeg.set(
          c.legislator_id,
          (billsInCmtCountByLeg.get(c.legislator_id) ?? 0) + 1,
        );
        break; // count each bill at most once per legislator
      }
    }
  }

  type DonorRow = {
    legislator_id: string;
    top_industries: Array<{ industry: string; amount: number; advocate_flag?: boolean }> | null;
    kratom_relevant: { pharma?: number; alcohol?: number; tobacco?: number; hospital_health?: number; total?: number } | null;
  };
  const donorByLeg = new Map<string, DonorRow>();
  for (const d of (donorsRaw.data ?? []) as DonorRow[]) {
    donorByLeg.set(d.legislator_id, d);
  }

  const tradeCountByLeg = new Map<string, number>();
  for (const t of (tradesRaw.data ?? []) as Array<{ legislator_id: string | null }>) {
    if (!t.legislator_id) continue;
    tradeCountByLeg.set(t.legislator_id, (tradeCountByLeg.get(t.legislator_id) ?? 0) + 1);
  }

  // billId → set of cluster slugs (from cluster-members join)
  const billToClusterSlugs = new Map<string, Set<string>>();
  for (const m of (clusterMembersRaw.data ?? []) as Array<{
    bill_id: string;
    bill_clusters: { slug: string } | Array<{ slug: string }> | null;
  }>) {
    const c = Array.isArray(m.bill_clusters) ? m.bill_clusters[0] : m.bill_clusters;
    if (!c) continue;
    if (!billToClusterSlugs.has(m.bill_id)) billToClusterSlugs.set(m.bill_id, new Set());
    billToClusterSlugs.get(m.bill_id)!.add(c.slug);
  }
  // legislator_id → set of cluster slugs they primary-sponsor on
  const clusterCountByLeg = new Map<string, Set<string>>();
  for (const s of (sponsorsRaw.data ?? []) as Array<{
    legislator_id: string;
    classification: string;
    bill_id: string;
  }>) {
    if (s.classification !== "primary") continue;
    const slugs = billToClusterSlugs.get(s.bill_id);
    if (!slugs) continue;
    if (!clusterCountByLeg.has(s.legislator_id)) clusterCountByLeg.set(s.legislator_id, new Set());
    for (const slug of slugs) clusterCountByLeg.get(s.legislator_id)!.add(slug);
  }

  // ── Score every legislator
  const scored: ScoredRow[] = [];
  for (const leg of legs) {
    const stance: Stance = stanceByLeg.get(leg.id) ?? "unknown";
    const sponsorship = sponsorshipByLeg.get(leg.id) ?? {
      primary_count: 0, cosponsor_count: 0, has_anti: false, has_pro: false,
      anti_primary_count: 0, pro_primary_count: 0,
    };
    const committee = committeeByLeg.get(leg.id) ?? { is_chair_relevant: false, is_member_relevant: false };
    const billsInCmt = billsInCmtCountByLeg.get(leg.id) ?? 0;
    const donor = donorByLeg.get(leg.id);
    const tradeCount = tradeCountByLeg.get(leg.id) ?? null;

    const isFederal = leg.role === "us_senate" || leg.role === "us_house";

    // Extract flagged industry amounts for the scorer
    function industryAmt(name: string): number | null {
      if (!isFederal) return null;
      const row = (donor?.top_industries ?? []).find((i) => i.industry === name);
      return row?.amount ?? 0;
    }

    const assessment = assessThreat({
      stance,
      has_anti_sponsorship: sponsorship.has_anti,
      has_pro_sponsorship: sponsorship.has_pro,
      primary_sponsorship_count: sponsorship.anti_primary_count,
      cosponsorship_count: sponsorship.cosponsor_count,
      is_chair_of_kratom_relevant: committee.is_chair_relevant,
      is_member_of_kratom_relevant: committee.is_member_relevant,
      bills_in_their_committees: billsInCmt,
      pharma_usd: industryAmt("pharma_biotech"),
      alcohol_usd: industryAmt("alcohol"),
      tobacco_usd: industryAmt("tobacco_nicotine"),
      addiction_treatment_usd: industryAmt("addiction_treatment"),
      cannabis_usd: industryAmt("cannabis"),
      gaming_usd: industryAmt("gaming_casino"),
      hospital_health_usd: industryAmt("hospital_health"),
      kratom_adjacent_trade_count: isFederal ? tradeCount : null,
    });

    // Compute flagged-industry total for display
    const flaggedIndustryTotal = (donor?.top_industries ?? [])
      .filter((i) => i.advocate_flag)
      .reduce((sum, i) => sum + (i.amount || 0), 0);

    scored.push({
      legislator: leg,
      assessment,
      signals: {
        stance,
        anti_sponsor_count: sponsorship.anti_primary_count,
        pro_sponsor_count: sponsorship.pro_primary_count,
        cosponsor_count: sponsorship.cosponsor_count,
        has_anti_sponsorship: sponsorship.has_anti,
        has_pro_sponsorship: sponsorship.has_pro,
        is_chair_of_kratom_relevant: committee.is_chair_relevant,
        is_member_of_kratom_relevant: committee.is_member_relevant,
        bills_in_committees: billsInCmt,
        kratom_adjacent_trade_count: tradeCount,
        flagged_industry_total: flaggedIndustryTotal,
        cluster_count: clusterCountByLeg.get(leg.id)?.size ?? 0,
      },
    });
  }

  // ── Group by tier, then sort within tier
  const byTier = new Map<ThreatTier, ScoredRow[]>();
  for (const tier of TIER_ORDER) byTier.set(tier, []);
  for (const r of scored) {
    byTier.get(r.assessment.tier)!.push(r);
  }
  for (const [tier, rows] of byTier) {
    // Within "active opponent" and "hostile decision-maker" sort by threat DESC
    // Within "flippable target" sort by vulnerability DESC
    // Within others, mixed sort by max(threat, vuln) DESC
    rows.sort((a, b) => {
      if (tier === "active_opponent" || tier === "hostile_decision_maker") {
        return b.assessment.threat_score - a.assessment.threat_score;
      }
      if (tier === "flippable_target") {
        return b.assessment.vulnerability_score - a.assessment.vulnerability_score;
      }
      const aMax = Math.max(a.assessment.threat_score, a.assessment.vulnerability_score);
      const bMax = Math.max(b.assessment.threat_score, b.assessment.vulnerability_score);
      return bMax - aMax;
    });
  }

  // Total non-low-priority counts (the actionable tiers)
  const totalActionable = TIER_ORDER
    .filter((t) => t !== "low_priority")
    .reduce((sum, t) => sum + (byTier.get(t)?.length ?? 0), 0);

  // Filtered tiers to render
  const tiersToShow = tierFilter ? [tierFilter] : TIER_ORDER.filter((t) => t !== "low_priority");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">
          ← Intel hub
        </Link>
      </div>

      <header className="mb-8">
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Threat matrix
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Who to target, who to flip
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Every active legislator ranked into one of seven action tiers based on a composite score
          across <strong className="text-zinc-200">stance, sponsorships, committee leverage, donor
          industries, and STOCK Act personal trades</strong>. This is the targeting view —
          who to neutralize, who to flip, who to reinforce. Click any row for the full briefing.
        </p>
        <p className="mt-2 max-w-3xl text-[11px] text-zinc-500">
          {totalActionable.toLocaleString()} legislator{totalActionable === 1 ? "" : "s"} with material
          signal across {legs.length.toLocaleString()} scored. Scoring is deterministic — same inputs
          always produce the same scores; auditable in <code className="rounded bg-zinc-900 px-1 py-0.5">src/lib/legislator-threat-score.ts</code>.
        </p>
      </header>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/intel/threat-matrix"
          className={`rounded-full px-3 py-1 transition ${
            !tierFilter && !stateFilter
              ? "bg-emerald-500 font-semibold text-zinc-950"
              : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
          }`}
        >
          All actionable tiers
        </Link>
        {TIER_ORDER.filter((t) => t !== "low_priority").map((t) => (
          <Link
            key={t}
            href={`/intel/threat-matrix?tier=${t}${stateFilter ? `&state=${stateFilter}` : ""}`}
            className={`rounded-full px-3 py-1 transition ${
              tierFilter === t
                ? "bg-emerald-500 font-semibold text-zinc-950"
                : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
            }`}
          >
            {TIER_META[t].emoji} {TIER_META[t].label} ({byTier.get(t)?.length ?? 0})
          </Link>
        ))}
        {stateFilter && (
          <Link
            href={tierFilter ? `/intel/threat-matrix?tier=${tierFilter}` : "/intel/threat-matrix"}
            className="rounded-full border border-amber-700/50 bg-amber-950/30 px-3 py-1 text-amber-200 hover:border-amber-500"
          >
            State: {stateFilter} ×
          </Link>
        )}
      </div>

      {/* Tier sections */}
      {tiersToShow.map((tier) => {
        const rows = byTier.get(tier) ?? [];
        if (rows.length === 0) return null;
        const meta = TIER_META[tier];
        return (
          <section key={tier} className="mb-8">
            <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-200">
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
              <span className="text-[10px] font-normal text-zinc-500">
                ({rows.length}) — {meta.description}
              </span>
            </h2>
            <ul className="space-y-2">
              {rows.slice(0, 50).map((r) => (
                <li key={r.legislator.id}>
                  <Link
                    href={`/legislators/${r.legislator.id}/briefing`}
                    className={`block rounded-lg border p-3 transition hover:border-emerald-500 ${r.assessment.tier_color}`}
                  >
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="text-sm font-semibold">{r.legislator.full_name}</span>
                      <span className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono uppercase text-[10px] text-zinc-300">
                        {r.legislator.role.replace(/_/g, " ")}
                      </span>
                      <span className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                        {r.legislator.state}
                      </span>
                      {r.legislator.district && (
                        <span className="text-[10px] text-zinc-400">D{r.legislator.district}</span>
                      )}
                      {r.legislator.party && (
                        <span className="text-[10px] text-zinc-400">{r.legislator.party}</span>
                      )}
                      <span className="ml-auto flex items-center gap-3 text-[10px]">
                        <span title="Threat score (0-100) — anti-kratom power">
                          T: <strong className="font-mono tabular-nums text-red-300">{r.assessment.threat_score}</strong>
                        </span>
                        <span title="Vulnerability score (0-100) — flippability">
                          V: <strong className="font-mono tabular-nums text-amber-300">{r.assessment.vulnerability_score}</strong>
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] opacity-90">
                      {r.assessment.rationale}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                      {r.signals.has_anti_sponsorship && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-200">
                          🚫 {r.signals.anti_sponsor_count} restrictive bill{r.signals.anti_sponsor_count === 1 ? "" : "s"}
                        </span>
                      )}
                      {r.signals.cluster_count >= 2 && (
                        <span
                          className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-200"
                          title="Distinct coordinated operations this legislator primary-sponsors bills for"
                        >
                          🕸 {r.signals.cluster_count} operations
                        </span>
                      )}
                      {r.signals.has_pro_sponsorship && (
                        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-200">
                          ⭐ {r.signals.pro_sponsor_count} pro bill{r.signals.pro_sponsor_count === 1 ? "" : "s"}
                        </span>
                      )}
                      {r.signals.is_chair_of_kratom_relevant && (
                        <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-amber-200">
                          🪑 Chair
                        </span>
                      )}
                      {r.signals.is_member_of_kratom_relevant && !r.signals.is_chair_of_kratom_relevant && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                          🏛 Committee
                        </span>
                      )}
                      {r.signals.bills_in_committees > 0 && (
                        <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-amber-200">
                          ⚡ {r.signals.bills_in_committees} deciding now
                        </span>
                      )}
                      {r.signals.flagged_industry_total >= 10_000 && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-200">
                          ⚠ ${(r.signals.flagged_industry_total / 1000).toFixed(0)}k flagged $
                        </span>
                      )}
                      {r.signals.kratom_adjacent_trade_count != null && r.signals.kratom_adjacent_trade_count > 0 && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-200">
                          📈 {r.signals.kratom_adjacent_trade_count} kratom-adjacent trades
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
              {rows.length > 50 && (
                <li className="text-[11px] text-zinc-500">
                  + {rows.length - 50} more in this tier — filter by state to drill in.
                </li>
              )}
            </ul>
          </section>
        );
      })}

      {totalActionable === 0 && !stateFilter && !tierFilter && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No actionable legislators scored. The stance drafter + donor pipeline may not have run a full pass yet.
        </div>
      )}

      <p className="mt-8 text-[10px] text-zinc-600">
        Scoring inputs: stance (legislator_kratom_stance), sponsorships (bill_sponsors), committee
        memberships (legislator_committees), active bills in committee (bills), donor industries
        (legislator_donors.top_industries), STOCK Act trades (federal_personal_trades). Federal
        legislators have donor + trade signals; state legislators don&apos;t (yet). All scoring code
        in <code className="rounded bg-zinc-900 px-1 py-0.5">src/lib/legislator-threat-score.ts</code>.
      </p>
    </div>
  );
}
