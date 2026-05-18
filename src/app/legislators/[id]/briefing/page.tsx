import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { committeesMatch } from "@/lib/bill-committee";
import {
  buildActionPlan,
  CHANNEL_LABEL,
  STANCE_META,
  type Stance,
  type LeverageSignal,
} from "@/lib/legislator-action-plan";
import { actorsForLegislator, FACTION_META, ROLE_LABEL } from "@/lib/kratom-industry-actors";
import { RemindMeButton } from "@/components/RemindMeButton";
import { getAdminContext } from "@/modules/admin/actions";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: leg } = await sb
    .from("legislators")
    .select("full_name, state, role, district")
    .eq("id", id)
    .maybeSingle();
  if (!leg) return { title: "Intel briefing — legislator not found" };
  return {
    title: `${(leg as { full_name: string }).full_name} — kratom intel briefing`,
    description: `Kratom-policy intel briefing for ${(leg as { full_name: string }).full_name}: stance, committee leverage, sponsorship history, donor signals, and a constituent action plan.`,
    robots: { index: false }, // briefings are advocate-facing, not SEO
  };
}

/**
 * /legislators/[id]/briefing
 *
 * Phase 1 intel briefing per legislator. Combines everything we know
 * about a person's kratom posture into one page, plus a rule-based
 * action plan for advocates contacting them.
 *
 * Sections:
 *   1. Header — name, role, district, party, at-a-glance stance chip
 *   2. Posture summary — stance rationale + evidence URL (if drafted)
 *   3. Leverage flags — chip-style signals (committee chair, anti-sponsor,
 *      donor conflicts, "this is YOUR rep" etc.)
 *   4. Action plan — primary channel, talking points, watch-outs
 *      (all rule-based — see src/lib/legislator-action-plan.ts)
 *   5. Currently deciding — bills in their committees right now
 *   6. Sponsorship history — bills they've authored or cosponsored
 *   6b. Voting record — Phase 3 D1; roll-call history on kratom bills
 *   6c. News mentions — Phase 3 D4; per-legislator hits in news_items
 *   7. Committee positions — full assignment list, kratom-relevant flagged
 *   8. Donor profile — federal only (matched_status='matched')
 *   9. Intel gaps — honest "we don't have X yet" with admin-request links
 *
 * Public — anyone can read. Signed-in users with this person as their
 * rep get a "📍 Your representative" flag and one-click action buttons.
 */
export default async function BriefingPage({ params }: { params: Params }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: legRaw } = await sb
    .from("legislators")
    .select("id, state, role, district, full_name, party, email, phone, office_address, website, level, locality, body, title, active")
    .eq("id", id)
    .maybeSingle();
  if (!legRaw) notFound();
  const leg = legRaw as {
    id: string; state: string; role: string; district: string | null;
    full_name: string; party: string | null; email: string | null;
    phone: string | null; office_address: string | null; website: string | null;
    level: string | null; locality: string | null; body: string | null; title: string | null;
    active: boolean;
  };

  // ── Parallel pulls
  const [
    stanceRow,
    sponsorshipsRaw,
    committeesRaw,
    donorRow,
    viewerData,
    votingRaw,
    newsMentionsRaw,
    personalTradesRaw,
  ] = await Promise.all([
    sb.from("legislator_kratom_stance")
      .select("stance, rationale_md, last_evidence_url, last_updated_at")
      .eq("legislator_id", id)
      .maybeSingle(),
    sb.from("bill_sponsors")
      .select("bill_id, classification, bills(id, bill_number, title, kratom_relevance, status, last_action_at, state, current_committee_name)")
      .eq("legislator_id", id),
    sb.from("legislator_committees")
      .select("committee_name, role, is_kratom_relevant")
      .eq("legislator_id", id),
    leg.role === "us_senate" || leg.role === "us_house"
      ? sb.from("legislator_donors")
          .select("cycle, total_receipts, top_industries, top_employers, kratom_relevant, resolved_status, synced_at")
          .eq("legislator_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb.auth.getUser(),
    // Phase 3 D1: voting record. Wrapped in try-style fallback so
    // pre-migration deploys (before 0126) render the rest of the
    // page without erroring. Pulls every kratom-bill vote where this
    // legislator participated, joined to the bill metadata.
    sb.from("bill_vote_members")
      .select("vote_text, vote_value, bill_vote_id, bill_votes!inner(vote_date, chamber, motion, passed, yea_count, nay_count, bills!inner(id, bill_number, kratom_relevance, title, state))")
      .eq("legislator_id", id)
      .order("bill_votes(vote_date)", { ascending: false })
      .limit(50),
    // Phase 3 D4 Phase 1: per-legislator news mentions. Joined to
    // news_items for outlet + title + date. Defensive: pre-migration
    // (before 0127) renders the rest of the page without erroring.
    sb.from("legislator_news_mentions")
      .select("matched_field, mention_context, match_confidence, news_items!inner(id, title, source_name, url, published_at, state)")
      .eq("legislator_id", id)
      .order("news_items(published_at)", { ascending: false })
      .limit(30),
    // STOCK Act personal trades — federal only. We split into two
    // queries because prolific traders have many trades but few in
    // kratom-adjacent industries — sorting by date and limiting would
    // drop the most relevant rows. So: pull ALL kratom-adjacent +
    // the latest N non-adjacent for context. Pre-migration deploys
    // (before 0138) get null arrays and render no section.
    leg.role === "us_senate" || leg.role === "us_house"
      ? Promise.all([
          sb.from("federal_personal_trades")
            .select("id, transaction_date, filing_date, transaction_type, ticker, asset_description, asset_type, amount_range, amount_lower, amount_upper, owner, is_kratom_adjacent, kratom_relevance_note, ptr_link, chamber")
            .eq("legislator_id", id)
            .eq("is_kratom_adjacent", true)
            .order("transaction_date", { ascending: false, nullsFirst: false }),
          sb.from("federal_personal_trades")
            .select("id, transaction_date, filing_date, transaction_type, ticker, asset_description, asset_type, amount_range, amount_lower, amount_upper, owner, is_kratom_adjacent, kratom_relevance_note, ptr_link, chamber")
            .eq("legislator_id", id)
            .eq("is_kratom_adjacent", false)
            .order("transaction_date", { ascending: false, nullsFirst: false })
            .limit(50),
          sb.from("federal_personal_trades")
            .select("id", { count: "exact", head: true })
            .eq("legislator_id", id),
        ])
      : Promise.resolve(null),
  ]);

  const stance: Stance =
    ((stanceRow.data as { stance?: Stance } | null)?.stance) ?? "unknown";
  const stanceRationale = (stanceRow.data as { rationale_md?: string | null } | null)?.rationale_md ?? null;
  const stanceEvidence = (stanceRow.data as { last_evidence_url?: string | null } | null)?.last_evidence_url ?? null;
  const stanceUpdated = (stanceRow.data as { last_updated_at?: string | null } | null)?.last_updated_at ?? null;

  // Sponsorships — flatten + classify
  type SponsorshipLite = {
    bill_id: string;
    classification: string; // 'primary' | 'cosponsor' | other
    bill_number: string;
    title: string | null;
    kratom_relevance: string | null;
    status: string | null;
    last_action_at: string | null;
    current_committee_name: string | null;
  };
  const sponsorships: SponsorshipLite[] = [];
  for (const s of (sponsorshipsRaw.data ?? []) as Array<{
    bill_id: string;
    classification: string;
    bills: { id: string; bill_number: string; title: string | null; kratom_relevance: string | null; status: string | null; last_action_at: string | null; state: string; current_committee_name: string | null } | Array<unknown> | null;
  }>) {
    const b = Array.isArray(s.bills) ? (s.bills[0] as typeof s.bills) : s.bills;
    if (!b || Array.isArray(b)) continue;
    const bill = b as { id: string; bill_number: string; title: string | null; kratom_relevance: string | null; status: string | null; last_action_at: string | null; current_committee_name: string | null };
    sponsorships.push({
      bill_id: s.bill_id,
      classification: s.classification,
      bill_number: bill.bill_number,
      title: bill.title,
      kratom_relevance: bill.kratom_relevance,
      status: bill.status,
      last_action_at: bill.last_action_at,
      current_committee_name: bill.current_committee_name,
    });
  }

  // Committees
  type Cmt = { committee_name: string; role: string; is_kratom_relevant: boolean | null };
  const committees: Cmt[] = (committeesRaw.data ?? []) as Cmt[];
  const kratomCommittees = committees.filter((c) => c.is_kratom_relevant);
  const isChairOfKratomRelevant = kratomCommittees.some((c) => c.role === "chair");
  const isMemberOfKratomRelevant = kratomCommittees.length > 0;

  // ── "Currently deciding" cross-reference: which active bills in
  // this person's state are in committees they sit on right now?
  let currentlyDeciding: Array<{ id: string; bill_number: string; title: string | null; kratom_relevance: string | null; committee: string; role: string }> = [];
  try {
    if (committees.length > 0) {
      const { data: stateBills } = await sb
        .from("bills")
        .select("id, bill_number, title, kratom_relevance, current_committee_name")
        .eq("state", leg.state)
        .eq("active", true)
        .not("current_committee_name", "is", null)
        .order("last_action_at", { ascending: false, nullsFirst: false })
        .limit(200);
      for (const b of (stateBills ?? []) as Array<{ id: string; bill_number: string; title: string | null; kratom_relevance: string | null; current_committee_name: string | null }>) {
        if (!b.current_committee_name) continue;
        const match = committees.find((c) => committeesMatch(b.current_committee_name!, c.committee_name));
        if (!match) continue;
        currentlyDeciding.push({
          id: b.id,
          bill_number: b.bill_number,
          title: b.title,
          kratom_relevance: b.kratom_relevance,
          committee: match.committee_name,
          role: match.role,
        });
      }
      // Dedupe + anti-first
      const seen = new Set<string>();
      currentlyDeciding = currentlyDeciding
        .filter((d) => seen.has(d.id) ? false : (seen.add(d.id), true))
        .sort((a, b) => {
          if (a.kratom_relevance === "anti" && b.kratom_relevance !== "anti") return -1;
          if (b.kratom_relevance === "anti" && a.kratom_relevance !== "anti") return 1;
          return 0;
        })
        .slice(0, 15);
    }
  } catch {
    // Pre-migration deploy — silent fallback.
  }

  // ── Sponsorship signal aggregation
  const primary = sponsorships.filter((s) => s.classification === "primary");
  const cosponsor = sponsorships.filter((s) => s.classification !== "primary");
  const has_anti_sponsorship = sponsorships.some((s) => s.kratom_relevance === "anti");
  const has_pro_sponsorship = sponsorships.some((s) => s.kratom_relevance === "pro");

  // ── Voting record (Phase 3 D1). Flatten the joined response into
  // a clean shape. votingRaw.data may be null on pre-migration deploys
  // (table doesn't exist yet) — wrap defensively.
  type VotingRecord = {
    bill_id: string;
    bill_number: string;
    bill_title: string | null;
    bill_state: string;
    kratom_relevance: string | null;
    vote_text: string;
    vote_value: number;
    vote_date: string | null;
    chamber: string | null;
    motion: string | null;
    passed: boolean | null;
    yea_count: number | null;
    nay_count: number | null;
  };
  type BillVoteJoinedBill = {
    id: string;
    bill_number: string;
    kratom_relevance: string | null;
    title: string | null;
    state: string;
  };
  type BillVoteJoined = {
    vote_date: string | null;
    chamber: string | null;
    motion: string | null;
    passed: boolean | null;
    yea_count: number | null;
    nay_count: number | null;
    bills: BillVoteJoinedBill | BillVoteJoinedBill[] | null;
  };
  type VoteMemberJoined = {
    vote_text: string;
    vote_value: number;
    bill_votes: BillVoteJoined | BillVoteJoined[] | null;
  };
  const votingRecord: VotingRecord[] = [];
  try {
    for (const row of ((votingRaw?.data ?? []) as VoteMemberJoined[])) {
      const bv = Array.isArray(row.bill_votes) ? row.bill_votes[0] : row.bill_votes;
      if (!bv) continue;
      const b = Array.isArray(bv.bills) ? bv.bills[0] : bv.bills;
      if (!b) continue;
      votingRecord.push({
        bill_id: b.id,
        bill_number: b.bill_number,
        bill_title: b.title,
        bill_state: b.state,
        kratom_relevance: b.kratom_relevance,
        vote_text: row.vote_text,
        vote_value: row.vote_value,
        vote_date: bv.vote_date,
        chamber: bv.chamber,
        motion: bv.motion,
        passed: bv.passed,
        yea_count: bv.yea_count,
        nay_count: bv.nay_count,
      });
    }
  } catch {
    // Pre-migration deploy — silently empty.
  }

  // ── News mentions (Phase 3 D4 Phase 1). Dedupe by news_item_id —
  // a legislator named in both title AND summary yields two rows in
  // the table but we want one card per article. Keep the row with
  // the richest context (title > summary > body in priority).
  type NewsMentionItem = {
    news_id: string;
    news_title: string;
    source_name: string | null;
    url: string | null;
    published_at: string | null;
    matched_field: string;
    mention_context: string | null;
    match_confidence: string;
  };
  type NewsItemJoined = {
    id: string;
    title: string;
    source_name: string | null;
    url: string | null;
    published_at: string | null;
    state: string;
  };
  type NewsMentionJoined = {
    matched_field: string;
    mention_context: string | null;
    match_confidence: string;
    news_items: NewsItemJoined | NewsItemJoined[] | null;
  };
  const FIELD_PRIORITY: Record<string, number> = { title: 3, summary: 2, body: 1 };
  const newsMentionsByArticle = new Map<string, NewsMentionItem>();
  try {
    for (const row of ((newsMentionsRaw?.data ?? []) as NewsMentionJoined[])) {
      const n = Array.isArray(row.news_items) ? row.news_items[0] : row.news_items;
      if (!n) continue;
      const existing = newsMentionsByArticle.get(n.id);
      const newPriority = FIELD_PRIORITY[row.matched_field] ?? 0;
      const oldPriority = existing ? FIELD_PRIORITY[existing.matched_field] ?? 0 : -1;
      if (newPriority > oldPriority) {
        newsMentionsByArticle.set(n.id, {
          news_id: n.id,
          news_title: n.title,
          source_name: n.source_name,
          url: n.url,
          published_at: n.published_at,
          matched_field: row.matched_field,
          mention_context: row.mention_context,
          match_confidence: row.match_confidence,
        });
      }
    }
  } catch {
    // Pre-migration deploy — silently empty.
  }
  const newsMentions = [...newsMentionsByArticle.values()].sort((a, b) => {
    const ad = a.published_at ? new Date(a.published_at).getTime() : 0;
    const bd = b.published_at ? new Date(b.published_at).getTime() : 0;
    return bd - ad;
  });

  // News on bills this legislator sponsors. Implicit mention path:
  // even if a legislator isn't named in an article, news linked to a
  // bill they sponsor is still high-signal intel about their public
  // posture. Uses the post-#326/#332/#333 news_items.bill_id linkage.
  type SponsoredBillNews = {
    news_id: string;
    news_title: string;
    source_name: string | null;
    url: string | null;
    published_at: string | null;
    bill_id: string;
    bill_number: string;
    classification: string;
  };
  let sponsoredBillNews: SponsoredBillNews[] = [];
  try {
    const sponsoredIds = [...new Set(sponsorships.map((s) => s.bill_id))];
    if (sponsoredIds.length > 0) {
      const { data: sbnRaw } = await sb
        .from("news_items")
        .select("id, title, source_name, url, published_at, bill_id, bills!inner(bill_number)")
        .in("bill_id", sponsoredIds)
        .eq("active", true)
        .order("published_at", { ascending: false })
        .limit(30);
      const classByBill = new Map(sponsorships.map((s) => [s.bill_id, s.classification]));
      // De-dupe by news_id (an article might link to multiple sponsored bills).
      const seen = new Set<string>();
      for (const row of (sbnRaw ?? []) as Array<{
        id: string;
        title: string;
        source_name: string | null;
        url: string | null;
        published_at: string | null;
        bill_id: string;
        bills: { bill_number: string } | Array<{ bill_number: string }> | null;
      }>) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const b = Array.isArray(row.bills) ? row.bills[0] : row.bills;
        if (!b) continue;
        // Skip if the legislator was already explicitly named in this
        // article — explicit takes precedence so we don't double-show.
        if (newsMentionsByArticle.has(row.id)) continue;
        sponsoredBillNews.push({
          news_id: row.id,
          news_title: row.title,
          source_name: row.source_name,
          url: row.url,
          published_at: row.published_at,
          bill_id: row.bill_id,
          bill_number: b.bill_number,
          classification: classByBill.get(row.bill_id) ?? "cosponsor",
        });
      }
    }
  } catch {
    // News bill_id column missing (pre-0149) or other transient — silent empty.
    sponsoredBillNews = [];
  }

  // ── Donor signals (federal only)
  type DonorJsonKratomRelevant = { pharma?: number; alcohol?: number; tobacco?: number; retail?: number; hospital_health?: number; total?: number };
  type IndustryRow = {
    industry: string;
    label?: string;
    advocate_flag?: boolean;
    amount: number;
    count?: number;
    sample_employers?: string[];
  };
  const donor = donorRow?.data as null | {
    cycle: number | null;
    total_receipts: number | null;
    top_industries: IndustryRow[] | null;
    top_employers: Array<{ employer: string; amount: number }> | null;
    kratom_relevant: DonorJsonKratomRelevant | null;
    resolved_status: string | null;
    synced_at: string | null;
  };
  const donorMatched = donor?.resolved_status === "matched";
  // Industry-derived donor totals. classify-donor-industries.mjs writes
  // top_industries as a ranked array of {industry, amount, ...}. Pull
  // the three new advocate-relevant categories (addiction treatment,
  // cannabis, gaming) here so they can flow into the leverage signal.
  function industryAmount(id: string): number | null {
    if (!donorMatched) return null;
    const row = (donor?.top_industries ?? []).find((i) => i.industry === id);
    return row ? row.amount : 0;
  }
  const addiction_usd = industryAmount("addiction_treatment");
  const cannabis_usd = industryAmount("cannabis");
  const gaming_usd = industryAmount("gaming_casino");
  const pharma_usd = donorMatched ? (donor!.kratom_relevant?.pharma ?? null) : null;
  const alcohol_usd = donorMatched ? (donor!.kratom_relevant?.alcohol ?? null) : null;
  const tobacco_usd = donorMatched ? (donor!.kratom_relevant?.tobacco ?? null) : null;

  // ── STOCK Act personal trades (federal only). Defensive in case the
  // table doesn't exist yet (pre-0138 deploy) — null data is fine, we
  // render nothing.
  type PersonalTrade = {
    id: string;
    transaction_date: string | null;
    filing_date: string | null;
    transaction_type: string | null;
    ticker: string | null;
    asset_description: string;
    asset_type: string | null;
    amount_range: string | null;
    amount_lower: number | null;
    amount_upper: number | null;
    owner: string | null;
    is_kratom_adjacent: boolean | null;
    kratom_relevance_note: string | null;
    ptr_link: string | null;
    chamber: string | null;
  };
  let kratomAdjacentTrades: PersonalTrade[] = [];
  let otherTrades: PersonalTrade[] = [];
  let personalTradesTotalCount = 0;
  try {
    if (Array.isArray(personalTradesRaw)) {
      const [adjRes, otherRes, countRes] = personalTradesRaw as [
        { data: PersonalTrade[] | null },
        { data: PersonalTrade[] | null },
        { count: number | null },
      ];
      kratomAdjacentTrades = (adjRes?.data ?? []) as PersonalTrade[];
      otherTrades = (otherRes?.data ?? []) as PersonalTrade[];
      personalTradesTotalCount = countRes?.count ?? 0;
    }
  } catch {
    // Pre-migration deploy — silently empty.
  }
  const kratomAdjacentTradeCount =
    leg.role === "us_senate" || leg.role === "us_house" ? kratomAdjacentTrades.length : null;

  // ── Viewer-rep status
  const viewerUser = viewerData?.data?.user ?? null;
  let isUserRep = false;
  if (viewerUser) {
    const { data: prof } = await sb
      .from("profiles")
      .select("state, congressional_district, state_senate_district, state_house_district, city, county")
      .eq("id", viewerUser.id)
      .maybeSingle();
    if (prof) {
      const reps = await getUserLegislators(sb, prof as Parameters<typeof getUserLegislators>[1]);
      isUserRep = reps.some((r) => r.id === leg.id);
    }
  }

  // ── Build the action plan
  const signal: LeverageSignal = {
    isChairOfKratomRelevant,
    isMemberOfKratomRelevant,
    bills_in_their_committees_count: currentlyDeciding.length,
    primary_sponsorships: primary.length,
    cosponsorships: cosponsor.length,
    has_anti_sponsorship,
    has_pro_sponsorship,
    pharma_donations_usd: pharma_usd,
    alcohol_donations_usd: alcohol_usd,
    tobacco_donations_usd: tobacco_usd,
    addiction_treatment_donations_usd: addiction_usd,
    cannabis_donations_usd: cannabis_usd,
    gaming_donations_usd: gaming_usd,
    kratom_adjacent_trade_count: kratomAdjacentTradeCount,
    is_user_rep: isUserRep,
  };
  const plan = buildActionPlan(stance, signal);

  // Admin-only gate for the "Intel gaps" section. Public visitors
  // shouldn't see our roadmap of missing data — that telegraphs to
  // adversaries exactly where the platform is weakest. Internal
  // value preserved for owner/admin viewing.
  const adminCtx = await getAdminContext();
  const isAdminOrOwner = adminCtx.ok && (adminCtx.isAdmin || adminCtx.isOwner);
  const stanceMeta = STANCE_META[stance];

  // Threat-matrix tier assessment for the chip in the header. Same
  // composite scorer that powers /intel/threat-matrix; surfaces here
  // so users coming from the matrix see the rank + score in context,
  // and so we don't make them bounce back-and-forth to remember why
  // this person was on their list.
  const { assessThreat } = await import("@/lib/legislator-threat-score");
  function flaggedIndustryAmount(name: string): number | null {
    if (!donorMatched) return null;
    const row = (donor?.top_industries ?? []).find((i) => i.industry === name);
    return row?.amount ?? 0;
  }
  const threatAssessment = assessThreat({
    stance,
    has_anti_sponsorship,
    has_pro_sponsorship,
    primary_sponsorship_count: primary.filter((p) => p.kratom_relevance === "anti").length,
    cosponsorship_count: cosponsor.length,
    is_chair_of_kratom_relevant: isChairOfKratomRelevant,
    is_member_of_kratom_relevant: isMemberOfKratomRelevant,
    bills_in_their_committees: currentlyDeciding.length,
    pharma_usd: flaggedIndustryAmount("pharma_biotech"),
    alcohol_usd: flaggedIndustryAmount("alcohol"),
    tobacco_usd: flaggedIndustryAmount("tobacco_nicotine"),
    addiction_treatment_usd: flaggedIndustryAmount("addiction_treatment"),
    cannabis_usd: flaggedIndustryAmount("cannabis"),
    gaming_usd: flaggedIndustryAmount("gaming_casino"),
    hospital_health_usd: flaggedIndustryAmount("hospital_health"),
    kratom_adjacent_trade_count: kratomAdjacentTradeCount,
  });

  // Display helpers
  const displayRole = leg.role.replace(/_/g, " ");
  const tel = leg.phone?.replace(/[^\d+]/g, "");
  const mailtoSubject = encodeURIComponent(`Constituent ask: kratom policy — ${leg.state}`);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href={`/legislators/${leg.id}`} className="text-zinc-500 hover:text-emerald-400">
          ← {leg.full_name} profile
        </Link>
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Intel briefing
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{leg.full_name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono uppercase">{displayRole}</span>
          {leg.party && <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono">{leg.party}</span>}
          <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono">{leg.state}</span>
          {leg.district && <span className="rounded bg-zinc-900 px-2 py-0.5">District {leg.district}</span>}
          <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stanceMeta.tone}`}>
            {stanceMeta.emoji} {stanceMeta.label}
          </span>
          {/* Threat-matrix tier chip — surfaces /intel/threat-matrix's
              composite ranking so users coming from the matrix see the
              tier + scores in context. Click navigates back to that
              tier's filtered slice. */}
          <Link
            href={`/intel/threat-matrix?tier=${threatAssessment.tier}`}
            className={`ml-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-80 ${threatAssessment.tier_color}`}
            title={threatAssessment.rationale}
          >
            {threatAssessment.tier_emoji} {threatAssessment.tier_label}
            <span className="ml-1 font-mono text-[9px] opacity-75">
              T{threatAssessment.threat_score}·V{threatAssessment.vulnerability_score}
            </span>
          </Link>
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          One-page memo on this person&apos;s kratom posture, the leverage windows that exist right now, and what to do about them.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          <span className="font-semibold text-zinc-300">Targeting tier:</span>{" "}
          {threatAssessment.rationale}
        </p>
        {/* Custom reminder — set a follow-up about THIS legislator.
            Use case: "remind me to follow up Sen. Smith next Tuesday
            after committee" or "ping me when their session resumes." */}
        <div className="mt-4">
          <RemindMeButton
            targetKind="legislator"
            targetId={leg.id}
            defaultTitle={`Follow up: ${leg.full_name} (${leg.state})`}
            defaultMessage="Check stance, contact info, or recent bill votes."
          />
        </div>
      </header>

      {/* ── Leverage flags ─────────────────────────────────────── */}
      {plan.leverage_flags.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Leverage signals
          </h2>
          <ul className="flex flex-wrap gap-2">
            {plan.leverage_flags.map((flag, i) => {
              const cls =
                flag.severity === "alarm" ? "border-red-700/50 bg-red-950/30 text-red-200" :
                flag.severity === "warn" ? "border-amber-700/50 bg-amber-950/30 text-amber-200" :
                flag.severity === "win" ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-200" :
                "border-zinc-800 bg-zinc-950/40 text-zinc-300";
              return (
                <li key={i} className={`rounded-md border px-3 py-2 text-xs ${cls}`} title={flag.detail}>
                  <span className="mr-1.5">{flag.emoji}</span>
                  <span className="font-semibold">{flag.label}</span>
                  <p className="mt-0.5 text-[10px] opacity-80">{flag.detail}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Posture summary ────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
          Posture summary
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-100">
          {plan.posture}
        </p>
        {stanceRationale && (
          <details className="mt-3 rounded border border-zinc-800 bg-zinc-950/60">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-emerald-400">
              AI-drafted stance rationale (admin-reviewable) ▾
            </summary>
            <div className="border-t border-zinc-800 p-3">
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{stanceRationale}</p>
              {stanceEvidence && (
                <p className="mt-2 text-[11px]">
                  Evidence:{" "}
                  <a href={stanceEvidence} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline break-all">
                    {stanceEvidence}
                  </a>
                </p>
              )}
              {stanceUpdated && (
                <p className="mt-1 text-[10px] text-zinc-600">
                  Drafted {new Date(stanceUpdated).toLocaleDateString()} · admin review pending
                </p>
              )}
            </div>
          </details>
        )}
      </section>

      {/* ── Action plan ────────────────────────────────────────── */}
      <section className={`mb-6 rounded-lg border-2 p-5 ${
        plan.urgency === "high" ? "border-red-500 bg-red-950/15 shadow-[0_0_24px_-8px_rgba(239,68,68,0.5)]" :
        plan.urgency === "medium" ? "border-amber-500 bg-amber-950/15" :
        "border-zinc-700 bg-zinc-950/40"
      }`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            plan.urgency === "high" ? "bg-red-500 text-zinc-950" :
            plan.urgency === "medium" ? "bg-amber-500 text-zinc-950" :
            "bg-zinc-700 text-zinc-100"
          }`}>
            {plan.urgency} priority
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
            Action plan
          </h2>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <span className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-100">
            Primary: {CHANNEL_LABEL[plan.primary_channel]}
          </span>
          {plan.alt_channels.map((c) => (
            <span key={c} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
              {CHANNEL_LABEL[c]}
            </span>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Talking points
            </h3>
            <ul className="space-y-2 text-xs leading-relaxed text-zinc-200">
              {plan.talking_points.map((tp, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-400">•</span>
                  <span>{tp}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Watch-outs
            </h3>
            <ul className="space-y-2 text-xs leading-relaxed text-zinc-300">
              {plan.watch_outs.map((wo, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-amber-400">⚠</span>
                  <span>{wo}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Quick-action buttons */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
          {tel && (
            <a
              href={`tel:${tel}`}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              📞 Call {leg.phone}
            </a>
          )}
          {leg.email && (
            <a
              href={`mailto:${leg.email}?subject=${mailtoSubject}`}
              className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
            >
              ✉ Email
            </a>
          )}
          {leg.website && (
            <a
              href={leg.website}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
            >
              🌐 Official site ↗
            </a>
          )}
        </div>
      </section>

      {/* ── Currently deciding ─────────────────────────────────── */}
      {currentlyDeciding.length > 0 && (
        <section className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-950/10 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
            ⚡ Bills they decide right now ({currentlyDeciding.length})
          </h2>
          <ul className="space-y-2">
            {currentlyDeciding.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/bills/${d.id}`}
                  className="block rounded-md border border-emerald-700/40 bg-emerald-950/10 p-3 transition hover:border-emerald-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-mono font-semibold text-zinc-200">
                      {leg.state} · {d.bill_number}
                    </span>
                    {d.kratom_relevance === "anti" && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">Anti</span>
                    )}
                    {d.kratom_relevance === "pro" && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">Pro</span>
                    )}
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-400">
                      {d.committee} <span className="text-zinc-600">({d.role})</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-100">
                    {d.title?.slice(0, 110) ?? "(untitled)"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Sponsorship history ────────────────────────────────── */}
      {sponsorships.length > 0 ? (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Sponsorship history
          </h2>
          <p className="text-[11px] text-zinc-500">
            {primary.length} primary · {cosponsor.length} cosponsorship{cosponsor.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-3 space-y-2">
            {sponsorships.slice(0, 12).map((s) => (
              <li key={`${s.bill_id}-${s.classification}`}>
                <Link href={`/bills/${s.bill_id}`} className="block rounded border border-zinc-800 p-2 hover:border-emerald-500">
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      s.classification === "primary" ? "bg-amber-500 text-zinc-950" : "bg-zinc-800 text-zinc-300"
                    }`}>
                      {s.classification === "primary" ? "Primary" : "Cosponsor"}
                    </span>
                    <span className="font-mono font-semibold text-zinc-200">{s.bill_number}</span>
                    {s.kratom_relevance === "anti" && <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">Anti</span>}
                    {s.kratom_relevance === "pro" && <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">Pro</span>}
                    <span className="ml-auto text-zinc-500">{s.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-300 line-clamp-2">{s.title ?? "(untitled)"}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Voting record (Phase 3 D1) ─────────────────────────── */}
      {votingRecord.length > 0 && (() => {
        // Compute summary stats for the section header
        const yeaCount = votingRecord.filter((v) => v.vote_text?.toLowerCase().includes("yea") || v.vote_value === 1).length;
        const nayCount = votingRecord.filter((v) => v.vote_text?.toLowerCase().includes("nay") || v.vote_value === 2).length;
        const otherCount = votingRecord.length - yeaCount - nayCount;
        const VOTE_STYLE: Record<string, string> = {
          yea: "bg-emerald-950/40 text-emerald-300",
          nay: "bg-red-950/40 text-red-300",
        };
        return (
          <section className="mb-6 rounded-lg border-2 border-amber-500/40 bg-amber-950/10 p-5">
            <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
              🗳 Voting record on kratom bills
              <span className="text-[10px] font-normal text-zinc-500">
                ({votingRecord.length} roll-call vote{votingRecord.length === 1 ? "" : "s"} · {yeaCount} yea · {nayCount} nay{otherCount > 0 ? ` · ${otherCount} other` : ""})
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Actual voting history is the strongest predictive signal — much stronger than stance drafts. A YES on the last kratom bill is a near-certain YES on the next.
            </p>
            <ul className="mt-3 space-y-2">
              {votingRecord.slice(0, 15).map((v, i) => {
                const voteKey = v.vote_text?.toLowerCase().includes("yea") ? "yea"
                  : v.vote_text?.toLowerCase().includes("nay") ? "nay"
                  : "other";
                const voteCls = VOTE_STYLE[voteKey] ?? "bg-zinc-900 text-zinc-400";
                const isAnti = v.kratom_relevance === "anti";
                const isPro = v.kratom_relevance === "pro";
                return (
                  <li key={i}>
                    <a
                      href={`/bills/${v.bill_id}`}
                      className="block rounded-md border border-amber-700/20 bg-zinc-950/40 p-2.5 transition hover:border-amber-500"
                    >
                      <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                        <span className={`rounded px-1.5 py-0.5 font-bold uppercase ${voteCls}`}>
                          {v.vote_text || "?"}
                        </span>
                        <span className="font-mono font-semibold text-zinc-200">
                          {v.bill_state} · {v.bill_number}
                        </span>
                        {isAnti && (
                          <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">Anti</span>
                        )}
                        {isPro && (
                          <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">Pro</span>
                        )}
                        <span className="ml-auto text-zinc-500">
                          {v.vote_date ? new Date(v.vote_date).toLocaleDateString() : "—"}
                        </span>
                      </div>
                      {v.motion && (
                        <p className="mt-1 text-[11px] text-zinc-500">{v.motion}</p>
                      )}
                      {v.bill_title && (
                        <p className="mt-1 text-xs leading-snug text-zinc-100">
                          {v.bill_title.slice(0, 110)}{v.bill_title.length > 110 ? "…" : ""}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-zinc-600">
                        Final tally: {v.yea_count ?? "?"}–{v.nay_count ?? "?"}
                        {v.passed != null && (
                          <span className="ml-1">
                            ({v.passed ? "passed" : "failed"})
                          </span>
                        )}
                        {v.chamber && <span className="ml-1">· {v.chamber}</span>}
                      </p>
                    </a>
                  </li>
                );
              })}
            </ul>
            {votingRecord.length > 15 && (
              <p className="mt-2 text-[11px] text-zinc-500">
                + {votingRecord.length - 15} older votes not shown.
              </p>
            )}
          </section>
        );
      })()}

      {/* ── News mentions (Phase 3 D4 Phase 1) ─────────────────── */}
      {newsMentions.length > 0 && (
        <section className="mb-6 rounded-lg border border-sky-500/30 bg-sky-950/10 p-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-sky-300">
            📰 News mentions
            <span className="text-[10px] font-normal text-zinc-500">
              ({newsMentions.length} article{newsMentions.length === 1 ? "" : "s"})
            </span>
          </h2>
          <p className="text-[11px] text-zinc-400">
            Articles in our kratom-policy news index that named this legislator. Match is exact-name or title+lastname, state-scoped to reduce false positives.
          </p>
          <ul className="mt-3 space-y-2">
            {newsMentions.slice(0, 10).map((m) => (
              <li key={m.news_id}>
                <a
                  href={m.url ?? `#`}
                  target={m.url ? "_blank" : undefined}
                  rel={m.url ? "noopener noreferrer" : undefined}
                  className="block rounded-md border border-sky-700/20 bg-zinc-950/40 p-2.5 transition hover:border-sky-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-semibold text-zinc-100">
                      {m.news_title.slice(0, 140)}{m.news_title.length > 140 ? "…" : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[10px] text-zinc-500">
                    {m.source_name && <span>{m.source_name}</span>}
                    {m.published_at && (
                      <span>· {new Date(m.published_at).toLocaleDateString()}</span>
                    )}
                    <span className="ml-auto text-zinc-600">
                      matched in {m.matched_field}
                    </span>
                  </div>
                  {m.mention_context && (
                    <p className="mt-2 text-[11px] italic leading-snug text-zinc-400">
                      {m.mention_context}
                    </p>
                  )}
                </a>
              </li>
            ))}
          </ul>
          {newsMentions.length > 10 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              + {newsMentions.length - 10} older mentions not shown.
            </p>
          )}
        </section>
      )}

      {/* ── News on bills this legislator sponsors ───────────── */}
      {sponsoredBillNews.length > 0 && (
        <section className="mb-6 rounded-lg border border-sky-700/30 bg-sky-950/10 p-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-sky-300">
            📰 News on bills they sponsor
            <span className="text-[10px] font-normal text-zinc-500">
              ({sponsoredBillNews.length} article{sponsoredBillNews.length === 1 ? "" : "s"})
            </span>
          </h2>
          <p className="text-[11px] text-zinc-400">
            Articles indexed against bills this legislator authored or cosponsored. Implicit mentions — the legislator may not be named in the article but is on the bill.
          </p>
          <ul className="mt-3 space-y-2">
            {sponsoredBillNews.slice(0, 10).map((m) => (
              <li key={m.news_id}>
                <a
                  href={m.url ?? `#`}
                  target={m.url ? "_blank" : undefined}
                  rel={m.url ? "noopener noreferrer" : undefined}
                  className="block rounded-md border border-sky-700/20 bg-zinc-950/40 p-2.5 transition hover:border-sky-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-semibold text-zinc-100">
                      {m.news_title.slice(0, 140)}{m.news_title.length > 140 ? "…" : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[10px] text-zinc-500">
                    {m.source_name && <span>{m.source_name}</span>}
                    {m.published_at && (
                      <span>· {new Date(m.published_at).toLocaleDateString()}</span>
                    )}
                    <span className="ml-auto rounded bg-sky-950/40 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                      {m.bill_number} ({m.classification})
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
          {sponsoredBillNews.length > 10 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              + {sponsoredBillNews.length - 10} more not shown.
            </p>
          )}
        </section>
      )}

      {/* ── Committee positions ────────────────────────────────── */}
      {committees.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Committee positions ({committees.length})
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {committees.map((c, i) => (
              <li
                key={i}
                className={`rounded border px-2.5 py-1.5 text-xs ${
                  c.is_kratom_relevant ? "border-emerald-700/40 bg-emerald-950/10" : "border-zinc-800"
                }`}
              >
                <span className="font-semibold capitalize text-zinc-200">{c.role.replace(/_/g, " ")}</span>
                {" — "}
                <span className="text-zinc-400">{c.committee_name}</span>
                {c.is_kratom_relevant && (
                  <span className="ml-1.5 rounded bg-emerald-950/40 px-1 py-0.5 text-[9px] text-emerald-300">
                    KRATOM-RELEVANT
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Connected industry actors ──────────────────────────── */}
      {(() => {
        const connected = actorsForLegislator({ full_name: leg.full_name, state: leg.state });
        if (connected.length === 0) return null;
        return (
          <section className="mb-6 rounded-lg border-2 border-amber-500/60 bg-amber-950/15 p-5 shadow-[0_0_20px_-8px_rgba(245,158,11,0.4)]">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
              🎭 Connected industry actors ({connected.length})
            </h2>
            <p className="text-xs text-zinc-300">
              People + organizations in our <Link href="/intel/actors" className="text-emerald-400 hover:underline">industry actor registry</Link> with public-record connections to this legislator. Verify each via the cited sources before treating as actionable.
            </p>
            <ul className="mt-3 space-y-2">
              {connected.map((a) => {
                const factionMeta = FACTION_META[a.faction];
                return (
                  <li key={a.id} className="rounded-md border border-amber-700/30 bg-amber-950/10 p-3">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <Link href={`/intel/actors#${a.id}`} className="text-sm font-semibold text-zinc-100 hover:text-emerald-400">
                        {a.name}
                      </Link>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${factionMeta.tone}`}>
                        {factionMeta.emoji} {factionMeta.label}
                      </span>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                        {ROLE_LABEL[a.role]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-300">{a.summary}</p>
                    {a.former_government_role && (
                      <p className="mt-1 text-[11px] text-amber-200">
                        🔄 {a.former_government_role}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      {/* ── Donor profile (federal only) ───────────────────────── */}
      {donor && donorMatched && donor.total_receipts && donor.total_receipts > 0 && (
        <section className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            💰 Donor profile · cycle {donor.cycle ?? "?"}
          </h2>
          <p className="text-sm text-zinc-200">
            Total receipts:{" "}
            <span className="font-bold tabular-nums text-amber-200">
              ${donor.total_receipts.toLocaleString()}
            </span>
          </p>
          {donor.kratom_relevant && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {donor.kratom_relevant.pharma ? (
                <div className="rounded border border-amber-700/30 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-300">Pharma</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">${donor.kratom_relevant.pharma.toLocaleString()}</p>
                </div>
              ) : null}
              {donor.kratom_relevant.alcohol ? (
                <div className="rounded border border-amber-700/30 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-300">Alcohol</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">${donor.kratom_relevant.alcohol.toLocaleString()}</p>
                </div>
              ) : null}
              {donor.kratom_relevant.tobacco ? (
                <div className="rounded border border-amber-700/30 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-300">Tobacco</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">${donor.kratom_relevant.tobacco.toLocaleString()}</p>
                </div>
              ) : null}
              {donor.kratom_relevant.retail ? (
                <div className="rounded border border-amber-700/30 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-300">Retail/CPG</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">${donor.kratom_relevant.retail.toLocaleString()}</p>
                </div>
              ) : null}
              {donor.kratom_relevant.hospital_health ? (
                <div className="rounded border border-amber-700/30 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-300">Hospital/Health</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">${donor.kratom_relevant.hospital_health.toLocaleString()}</p>
                </div>
              ) : null}
            </div>
          )}
          {donor.top_industries && donor.top_industries.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                Top contributing industries
              </h3>
              <p className="mt-1 text-[10px] text-zinc-500">
                Derived from individual contribution employer names. The 5 substance-policy-adjacent
                buckets above (pharma / alcohol / tobacco / retail / hospital) are a subset; the
                table below shows the full picture across all industries we classify.
              </p>
              <ul className="mt-2 space-y-1">
                {donor.top_industries.slice(0, 12).map((row, i) => (
                  <li
                    key={i}
                    className={`flex flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-[11px] ${
                      row.advocate_flag
                        ? "border border-red-700/40 bg-red-950/15 text-red-100"
                        : "text-zinc-400"
                    }`}
                    title={
                      row.sample_employers && row.sample_employers.length > 0
                        ? `Examples: ${row.sample_employers.join(", ")}`
                        : undefined
                    }
                  >
                    {row.advocate_flag && (
                      <span className="text-[10px] font-bold text-red-300">⚠</span>
                    )}
                    <span className={row.advocate_flag ? "font-semibold" : ""}>
                      {row.label ?? row.industry}
                    </span>
                    {row.count != null && (
                      <span className="text-[9px] text-zinc-500">({row.count} contribs)</span>
                    )}
                    <span className="ml-auto font-mono tabular-nums text-zinc-200">
                      ${row.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-zinc-600">
                ⚠ = substance-policy-adjacent industry that warrants advocate scrutiny on kratom votes.
              </p>
            </div>
          )}
          {donor.synced_at && (
            <p className="mt-3 text-[10px] text-zinc-600">
              FEC data synced {new Date(donor.synced_at).toLocaleDateString()}
            </p>
          )}
        </section>
      )}

      {/* ── STOCK Act personal trades (federal only) ───────────── */}
      {personalTradesTotalCount > 0 && (
        <section className={`mb-6 rounded-lg border p-5 ${
          kratomAdjacentTrades.length > 0
            ? "border-red-700/50 bg-red-950/15"
            : "border-zinc-800 bg-zinc-950/40"
        }`}>
          <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wider ${
            kratomAdjacentTrades.length > 0 ? "text-red-300" : "text-zinc-400"
          }`}>
            📈 Personal stock trades · {personalTradesTotalCount} disclosed
            {kratomAdjacentTrades.length > 0 && (
              <span className="ml-2 rounded bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-100">
                {kratomAdjacentTrades.length} KRATOM-ADJACENT
              </span>
            )}
          </h2>
          <p className="text-xs text-zinc-400">
            STOCK Act Periodic Transaction Reports — self, spouse, and dependent trades filed within 30 days of execution.{" "}
            <a
              href={leg.role === "us_senate" ? "https://efdsearch.senate.gov" : "https://disclosures-clerk.house.gov"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              Source ↗
            </a>
          </p>

          {kratomAdjacentTrades.length > 0 && (
            <>
              <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-red-200">
                Kratom-adjacent trades
              </h3>
              <ul className="mt-2 space-y-2">
                {kratomAdjacentTrades.slice(0, 15).map((t) => (
                  <li key={t.id} className="rounded border border-red-700/30 bg-red-950/10 p-2.5">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-mono font-semibold text-red-200">
                        {t.transaction_date ?? "date unknown"}
                      </span>
                      <span className="font-semibold uppercase tracking-wide text-zinc-200">
                        {t.transaction_type ?? "trade"}
                      </span>
                      {t.ticker && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                          {t.ticker}
                        </span>
                      )}
                      {t.owner && t.owner.toLowerCase() !== "self" && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] capitalize text-zinc-400">
                          {t.owner}
                        </span>
                      )}
                      {t.amount_range && (
                        <span className="ml-auto font-mono tabular-nums text-amber-300">
                          {t.amount_range}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-300">{t.asset_description}</p>
                    {t.kratom_relevance_note && (
                      <p className="mt-1 text-[10px] italic text-red-300/80">
                        {t.kratom_relevance_note}
                      </p>
                    )}
                    {t.ptr_link && (
                      <a
                        href={t.ptr_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[10px] text-emerald-400 hover:underline"
                      >
                        View PTR ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {kratomAdjacentTrades.length > 15 && (
                <p className="mt-2 text-[10px] text-zinc-500">
                  + {kratomAdjacentTrades.length - 15} more kratom-adjacent trades
                </p>
              )}
            </>
          )}

          {otherTrades.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-emerald-400">
                Recent non-flagged trades ({Math.min(otherTrades.length, 50)} of {personalTradesTotalCount - kratomAdjacentTrades.length}) ▾
              </summary>
              <ul className="mt-2 space-y-1">
                {otherTrades.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-zinc-900 py-1.5 text-[11px]">
                    <span className="font-mono text-zinc-500">
                      {t.transaction_date ?? "—"}
                    </span>
                    <span className="text-zinc-300 capitalize">
                      {t.transaction_type?.toLowerCase() ?? "trade"}
                    </span>
                    {t.ticker && <span className="font-mono text-zinc-400">{t.ticker}</span>}
                    <span className="text-zinc-400">{t.asset_description.slice(0, 60)}{t.asset_description.length > 60 ? "…" : ""}</span>
                    {t.amount_range && (
                      <span className="ml-auto font-mono tabular-nums text-zinc-500">{t.amount_range}</span>
                    )}
                  </li>
                ))}
                {personalTradesTotalCount - kratomAdjacentTrades.length > otherTrades.length && (
                  <li className="pt-1 text-[10px] text-zinc-500">
                    + {personalTradesTotalCount - kratomAdjacentTrades.length - otherTrades.length} earlier non-flagged trades (not shown — view full disclosures via the source link above)
                  </li>
                )}
              </ul>
            </details>
          )}

          <p className="mt-3 text-[10px] text-zinc-600">
            Data via Senate Stock Watcher + House Stock Watcher community archives. Kratom-adjacency flags are heuristic (opioid/pharma/addiction/substance-policy tickers); verify each before publishing.
          </p>
        </section>
      )}

      {/* ── Intel gaps · admin-only ────────────────────────────────
          Hidden from public visitors. Telegraphing capability gaps
          to adversaries (which legislators have weak coverage, which
          data feeds aren't yet wired) is strategically costly. The
          internal roadmap visibility is preserved for owners + admins
          who need it for prioritization. */}
      {isAdminOrOwner && (
        <section className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/15 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Intel gaps · admin only
            </h2>
            <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
              🔒 internal
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {stance === "unknown" && !stanceRationale && (
              <li>· <span className="text-zinc-300">Stance assessment</span> — AI drafter hasn&apos;t run for this state yet, or the legislator has no kratom signal in our data.</li>
            )}
            {(leg.role === "us_senate" || leg.role === "us_house") && !donorMatched && (
              <li>· <span className="text-zinc-300">Federal donor profile</span> — FEC matching pending. The OpenFEC pipeline has a known matching gap; investigation in flight.</li>
            )}
            {!(leg.role === "us_senate" || leg.role === "us_house") && (
              <li>· <span className="text-zinc-300">Financial disclosures</span> — state-level lobbyist/donor data is not yet centralized in our system (50-state scraping effort).</li>
            )}
            {!(leg.role === "us_senate" || leg.role === "us_house") && (
              <li>· <span className="text-zinc-300">Personal stock trades</span> — STOCK Act disclosures are federal-only; state legislators have varied reporting (50-state effort needed).</li>
            )}
            {(leg.role === "us_senate" || leg.role === "us_house") && personalTradesTotalCount === 0 && (
              <li>· <span className="text-zinc-300">Personal stock trades</span> — no PTRs filed by this legislator, OR our name-matcher didn&apos;t resolve them. Senate Stock Watcher + House Stock Watcher are our sources.</li>
            )}
            <li>· <span className="text-zinc-300">Voting records</span> — roll-call votes aren&apos;t yet synced. Pipeline candidate via LegiScan API.</li>
            <li>· <span className="text-zinc-300">News mentions + sentiment</span> — we have news but don&apos;t per-legislator-index it yet.</li>
            <li>· <span className="text-zinc-300">Personal statements / press releases</span> — not scraped from official sites.</li>
          </ul>
          <p className="mt-3 text-[10px] text-zinc-600">
            Phase 2 of the briefing system will close these gaps. Admins can prioritize a specific legislator&apos;s enrichment via the request flow (forthcoming).
          </p>
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-800 pt-4 text-[10px] text-zinc-500">
        Briefing generated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC.
        Action plan is rule-based, not AI-generated. Stance rationale (where present) is AI-drafted and admin-reviewable.
        Always verify critical facts against the legislator&apos;s official site before public communication.
      </footer>
    </div>
  );
}
