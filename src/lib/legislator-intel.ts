/**
 * Shared legislator INTEL layer — the single source of truth for the
 * "Intel verdict" that leads both the canonical `/legislators/[id]` dossier
 * and the `/legislators/[id]/briefing` memo.
 *
 * Before this lib, BOTH pages re-derived the same verdict independently:
 * each pulled stance / committees / donor industries / personal trades and
 * re-ran the identical `flaggedIndustryAmount → assessThreat → pressureIndex
 * → pressureBand → buildMoneyConflict` chain inline. Two copies = two
 * maintenance points that silently drift. This file centralizes that:
 *
 *   - `computeIntelVerdict(signals)` — PURE, deterministic, unit-tested. The
 *     one place the verdict is computed. Both pages flow through it.
 *   - `industriesFromDonor(...)` — the (previously duplicated) donor-industry
 *     normalizer that maps a `legislator_donors.top_industries` row into the
 *     restriction-aligned buckets the verdict needs.
 *   - `getLegislatorIntel(sb, leg)` — one consolidated fetch+compute for the
 *     canonical page: pulls stance / sponsorships / committees / donor /
 *     trades once, derives the display materials AND the verdict together.
 *
 * Free-tier-safe by construction: the synthesis is rule-based (no AI). Real
 * data only — federal donor/trade signals are null for state legislators
 * (never fabricated).
 */
import type { createClient } from "@/lib/supabase/server";
import { committeesMatch } from "@/lib/bill-committee";
import { assessThreat, type ThreatAssessment } from "@/lib/legislator-threat-score";
import { buildMoneyConflict, type MoneyConflict } from "@/lib/legislator-money-analysis";
import type { Stance } from "@/lib/legislator-action-plan";

type SB = Awaited<ReturnType<typeof createClient>>;

// ── Normalized verdict inputs ────────────────────────────────────────────
// Industry $ totals from the legislator's classified donors. null = the
// figure is unavailable (state-level, or no federal donor match) — distinct
// from 0 (federal match, but nothing from that industry). Mirrors the
// null/0 contract `assessThreat` + `buildMoneyConflict` already rely on.
export type IntelIndustries = {
  pharma: number | null;
  alcohol: number | null;
  tobacco: number | null;
  addictionTreatment: number | null;
  cannabis: number | null;
  gaming: number | null;
  hospitalHealth: number | null;
};

export type IntelSignals = {
  stance: Stance;
  donorMatched: boolean;
  industries: IntelIndustries;
  hasAntiSponsorship: boolean;
  hasProSponsorship: boolean;
  /** primary sponsorships of ANTI-kratom bills (drives threat escalation) */
  primaryAntiCount: number;
  cosponsorCount: number;
  isChairOfKratomRelevant: boolean;
  isMemberOfKratomRelevant: boolean;
  /** active bills sitting in committees this legislator serves on */
  currentlyDecidingCount: number;
  /** kratom-adjacent personal trades; null for state legislators */
  kratomAdjacentTradeCount: number | null;
};

export type PressureBand = {
  label: "High" | "Moderate" | "Low";
  tone: string; // tailwind text-color fragment
  note: string;
};

export type IntelVerdict = {
  stance: Stance;
  threat: ThreatAssessment;
  pressureIndex: number;
  pressureBand: PressureBand;
  moneyConflict: MoneyConflict | null;
};

// Pressure Index → band. The geometric mean of threat × vulnerability is
// high only when BOTH stakes and movability are high; the band turns that
// 0-100 number into a "where does my effort pay off" read for advocates.
export function pressureBandFor(index: number): PressureBand {
  if (index >= 60) {
    return {
      label: "High",
      tone: "text-emerald-300",
      note: "Your pressure moves the needle most here — prioritize calls, emails, and constituent stories.",
    };
  }
  if (index >= 35) {
    return {
      label: "Moderate",
      tone: "text-amber-300",
      note: "Worth contacting — pressure helps, but pair it with coalition support or committee timing.",
    };
  }
  return {
    label: "Low",
    tone: "text-zinc-400",
    note: "Lower marginal return — either already aligned, or entrenched. Thank allies; for opponents, spend effort where it moves more.",
  };
}

/** A single `legislator_donors.top_industries` element. */
type IndustryRow = { industry: string; amount: number };

// classify-donor-industries.mjs keys for the restriction-aligned buckets.
const INDUSTRY_KEYS = {
  pharma: "pharma_biotech",
  alcohol: "alcohol",
  tobacco: "tobacco_nicotine",
  addictionTreatment: "addiction_treatment",
  cannabis: "cannabis",
  gaming: "gaming_casino",
  hospitalHealth: "hospital_health",
} as const;

/**
 * Map a donor row's `top_industries` array into the normalized industry
 * buckets the verdict needs. donorMatched=false (state legislator or no FEC
 * match) → every bucket is null (unavailable, never fabricated as 0).
 *
 * This was previously a `flaggedIndustryAmount` helper copy-pasted verbatim
 * into both pages — centralized here so the keying can never drift.
 */
export function industriesFromDonor(
  donor: { top_industries?: IndustryRow[] | null } | null,
  donorMatched: boolean,
): IntelIndustries {
  const amt = (key: string): number | null => {
    if (!donorMatched) return null;
    return (donor?.top_industries ?? []).find((i) => i.industry === key)?.amount ?? 0;
  };
  return {
    pharma: amt(INDUSTRY_KEYS.pharma),
    alcohol: amt(INDUSTRY_KEYS.alcohol),
    tobacco: amt(INDUSTRY_KEYS.tobacco),
    addictionTreatment: amt(INDUSTRY_KEYS.addictionTreatment),
    cannabis: amt(INDUSTRY_KEYS.cannabis),
    gaming: amt(INDUSTRY_KEYS.gaming),
    hospitalHealth: amt(INDUSTRY_KEYS.hospitalHealth),
  };
}

/**
 * THE verdict computation — pure + deterministic. Same signals in → same
 * verdict out. Both the canonical dossier and the briefing memo call this so
 * the threat tier, pressure index, pressure band, and money conflict are
 * always identical for the same legislator.
 */
export function computeIntelVerdict(s: IntelSignals): IntelVerdict {
  const threat = assessThreat({
    stance: s.stance,
    has_anti_sponsorship: s.hasAntiSponsorship,
    has_pro_sponsorship: s.hasProSponsorship,
    primary_sponsorship_count: s.primaryAntiCount,
    cosponsorship_count: s.cosponsorCount,
    is_chair_of_kratom_relevant: s.isChairOfKratomRelevant,
    is_member_of_kratom_relevant: s.isMemberOfKratomRelevant,
    bills_in_their_committees: s.currentlyDecidingCount,
    pharma_usd: s.industries.pharma,
    alcohol_usd: s.industries.alcohol,
    tobacco_usd: s.industries.tobacco,
    addiction_treatment_usd: s.industries.addictionTreatment,
    cannabis_usd: s.industries.cannabis,
    gaming_usd: s.industries.gaming,
    hospital_health_usd: s.industries.hospitalHealth,
    kratom_adjacent_trade_count: s.kratomAdjacentTradeCount,
  });
  const pressureIndex = Math.round(
    Math.sqrt(threat.threat_score * threat.vulnerability_score),
  );
  const pressureBand = pressureBandFor(pressureIndex);
  const moneyConflict = buildMoneyConflict({
    donorMatched: s.donorMatched,
    industries: {
      pharma: s.industries.pharma,
      tobacco: s.industries.tobacco,
      alcohol: s.industries.alcohol,
      addictionTreatment: s.industries.addictionTreatment,
      hospitalHealth: s.industries.hospitalHealth,
    },
    kratomAdjacentTrades: s.kratomAdjacentTradeCount ?? 0,
    stance: s.stance,
    threatTier: threat.tier,
  });
  return { stance: s.stance, threat, pressureIndex, pressureBand, moneyConflict };
}

// ── Consolidated fetch+compute (server-side) ─────────────────────────────
export type IntelDonorRow = {
  cycle: number | null;
  total_receipts: number | null;
  top_industries: IndustryRow[] | null;
  top_employers: Array<{ employer: string; amount: number }> | null;
  kratom_relevant: {
    pharma?: number; retail?: number; alcohol?: number; tobacco?: number; hospital_health?: number; total?: number;
  } | null;
  resolved_status: string | null;
  synced_at: string | null;
};

export type IntelSponsorship = {
  bill_id: string;
  classification: string;
  bill_number: string;
  title: string | null;
  kratom_relevance: string | null;
  targets_natural_leaf: boolean | null;
  status: string | null;
  last_action_at: string | null;
  state: string;
};

export type IntelCommittee = { committee_name: string; role: string; is_kratom_relevant: boolean | null };

export type IntelDecidingBill = {
  bill_id: string;
  state: string;
  bill_number: string;
  title: string | null;
  kratom_relevance: string | null;
  committee_name: string;
  role: string;
};

export type SponsorshipSummary = { pro: number; anti: number; neutral: number; total: number; leafTargeting: number };

export type LegislatorIntel = {
  verdict: IntelVerdict;
  stance: Stance;
  donor: IntelDonorRow | null;
  donorMatched: boolean;
  sponsorships: IntelSponsorship[];
  summary: SponsorshipSummary;
  committees: IntelCommittee[];
  currentlyDeciding: IntelDecidingBill[];
  kratomAdjacentTradeCount: number | null;
};

type IntelLegislator = { id: string; state: string; role: string };

/**
 * Pull every intel signal for one legislator in a single consolidated round
 * of queries, derive the display materials, and compute the verdict — so the
 * canonical dossier has ONE call instead of a half-dozen scattered fetches +
 * an inline copy of the verdict math.
 *
 * Defensive: pre-migration schema gaps (missing tables/columns) degrade to
 * empty sections rather than throwing, matching the pages' prior behavior.
 */
export async function getLegislatorIntel(sb: SB, leg: IntelLegislator): Promise<LegislatorIntel> {
  const isFederal = leg.role === "us_senate" || leg.role === "us_house";

  const [stanceRes, sponsoredRes, committeesRes, donorRes, tradesRes] = await Promise.all([
    sb.from("legislator_stance").select("stance").eq("legislator_id", leg.id).eq("topic", "kratom").maybeSingle(),
    sb.from("bill_sponsors")
      .select("bill_id, classification, bills(bill_number, title, kratom_relevance, targets_natural_leaf, status, last_action_at, state)")
      .eq("legislator_id", leg.id),
    sb.from("legislator_committees").select("committee_name, role, is_kratom_relevant").eq("legislator_id", leg.id),
    isFederal
      ? sb.from("legislator_donors")
          .select("cycle, total_receipts, top_industries, top_employers, kratom_relevant, resolved_status, synced_at")
          .eq("legislator_id", leg.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    isFederal
      ? sb.from("federal_personal_trades").select("id", { count: "exact", head: true }).eq("legislator_id", leg.id).eq("is_kratom_adjacent", true)
      : Promise.resolve({ count: 0 }),
  ]);

  const stance = (((stanceRes.data as { stance?: string } | null)?.stance) ?? "unknown") as Stance;
  const donor = (donorRes.data as IntelDonorRow | null) ?? null;
  const donorMatched = donor?.resolved_status === "matched";

  // Sponsorships — flatten the joined bill, derive the kratom-record summary.
  type RawSponsor = {
    bill_id: string;
    classification: string;
    bills:
      | { bill_number: string; title: string | null; kratom_relevance: string | null; targets_natural_leaf: boolean | null; status: string | null; last_action_at: string | null; state: string }
      | Array<{ bill_number: string; title: string | null; kratom_relevance: string | null; targets_natural_leaf: boolean | null; status: string | null; last_action_at: string | null; state: string }>
      | null;
  };
  const sponsorships: IntelSponsorship[] = [];
  for (const s of (sponsoredRes.data ?? []) as RawSponsor[]) {
    const b = Array.isArray(s.bills) ? s.bills[0] : s.bills;
    if (!b) continue;
    sponsorships.push({
      bill_id: s.bill_id,
      classification: s.classification,
      bill_number: b.bill_number,
      title: b.title,
      kratom_relevance: b.kratom_relevance,
      targets_natural_leaf: b.targets_natural_leaf,
      status: b.status,
      last_action_at: b.last_action_at,
      state: b.state,
    });
  }
  const summary: SponsorshipSummary = { pro: 0, anti: 0, neutral: 0, total: sponsorships.length, leafTargeting: 0 };
  for (const s of sponsorships) {
    if (s.kratom_relevance === "pro") summary.pro++;
    else if (s.kratom_relevance === "anti") summary.anti++;
    else summary.neutral++;
    if (s.targets_natural_leaf === true) summary.leafTargeting++;
  }

  const committees = (committeesRes.data ?? []) as IntelCommittee[];
  const isMemberOfKratomRelevant = committees.some((c) => c.is_kratom_relevant);
  const isChairOfKratomRelevant = committees.some(
    (c) => c.is_kratom_relevant && (c.role === "chair" || c.role === "vice_chair"),
  );

  // "Currently deciding" — active bills sitting in committees this legislator
  // serves on right now. Anti-kratom first, deduped, capped at 10.
  let currentlyDeciding: IntelDecidingBill[] = [];
  try {
    if (committees.length > 0) {
      const { data: stateBills } = await sb
        .from("bills")
        .select("id, state, bill_number, title, kratom_relevance, current_committee_name, last_action_at")
        .eq("state", leg.state)
        .eq("active", true)
        .not("current_committee_name", "is", null)
        .order("last_action_at", { ascending: false, nullsFirst: false })
        .limit(200);
      for (const b of (stateBills ?? []) as Array<{ id: string; state: string; bill_number: string; title: string | null; kratom_relevance: string | null; current_committee_name: string | null }>) {
        if (!b.current_committee_name) continue;
        const matched = committees.find((c) => committeesMatch(b.current_committee_name!, c.committee_name));
        if (!matched) continue;
        currentlyDeciding.push({
          bill_id: b.id,
          state: b.state,
          bill_number: b.bill_number,
          title: b.title,
          kratom_relevance: b.kratom_relevance,
          committee_name: matched.committee_name,
          role: matched.role,
        });
      }
      const seen = new Set<string>();
      currentlyDeciding = currentlyDeciding
        .filter((x) => (seen.has(x.bill_id) ? false : (seen.add(x.bill_id), true)))
        .sort((a, b) => {
          if (a.kratom_relevance === "anti" && b.kratom_relevance !== "anti") return -1;
          if (b.kratom_relevance === "anti" && a.kratom_relevance !== "anti") return 1;
          return 0;
        })
        .slice(0, 10);
    }
  } catch {
    // Pre-migration deploy or schema mismatch — section silently absent.
  }

  const kratomAdjacentTradeCount = isFederal ? ((tradesRes as { count?: number | null }).count ?? 0) : null;
  const primaryAntiCount = sponsorships.filter((s) => s.classification === "primary" && s.kratom_relevance === "anti").length;
  const cosponsorCount = sponsorships.filter((s) => s.classification !== "primary").length;

  const verdict = computeIntelVerdict({
    stance,
    donorMatched,
    industries: industriesFromDonor(donor, donorMatched),
    hasAntiSponsorship: summary.anti > 0,
    hasProSponsorship: summary.pro > 0,
    primaryAntiCount,
    cosponsorCount,
    isChairOfKratomRelevant,
    isMemberOfKratomRelevant,
    currentlyDecidingCount: currentlyDeciding.length,
    kratomAdjacentTradeCount,
  });

  return {
    verdict,
    stance,
    donor,
    donorMatched,
    sponsorships,
    summary,
    committees,
    currentlyDeciding,
    kratomAdjacentTradeCount,
  };
}
