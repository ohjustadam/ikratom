import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { jsonLdSafe } from "@/lib/jsonld";
import { EmailGroupButton } from "@/modules/compose/EmailGroupButton";
import { getBillOfficialGroups, type BillOfficialGroups } from "@/modules/compose/bill-officials";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";
import { RemindMeButton } from "@/components/RemindMeButton";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { BillTimeline } from "./BillTimeline";
import { YourRepDecidingThisBill } from "./YourRepDecidingThisBill";
import { displayTitle, displaySubtitle } from "@/lib/bill-title";
import { billStatusLabel } from "@/lib/bill-status";
import { OfficialAvatar } from "@/components/OfficialAvatar";
import { fetchOpenStatesBillDetail } from "@/lib/openstates-bill";
import { getTranslation } from "@/lib/translations";
import { readLocale } from "@/modules/auth/actions-locale";
import { BillFullText } from "./BillFullText";
import { BillLocalActionCard, type LocalMeta, type LocalOfficial } from "./BillLocalActionCard";
import { findSimilarBillsCached } from "@/lib/bill-similarity";
import { IntelTipForm } from "./IntelTipForm";
import { Markdown } from "@/components/Markdown";
import { mdToPlainText } from "@/lib/markdown";
import { AudioReader } from "@/components/AudioReader";
import { dedupNews, type NewsItem } from "@/lib/news-dedup";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { StanceChips, roleMeta, orderedDisplayRoles, displayRole, type StanceValue } from "@/lib/stakeholder-stance";
import { computeBillMomentum, MOMENTUM_LABEL, MOMENTUM_TONE } from "@/lib/bill-momentum";

// Force dynamic so per-viewer reads (auth, subscription state, the viewer's
// civic profile) always run request-bound; the large PUBLIC read-set is served
// from a per-id unstable_cache snapshot (getBillPublicSnapshot) so a bill that
// just synced still refreshes within the snapshot's 15-min revalidate window.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BillRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary: string | null;
  summary_ai: string | null;
  advocacy_callout: string | null;
  status: string | null;
  kratom_relevance: string | null;
  relevance_confidence: number | null;
  last_action: string | null;
  last_action_at: string | null;
  current_committee_name: string | null;
  active: boolean | null;
  source_url: string | null;
  official_url: string | null;
  session_id: string | null;
  scope: string | null;
  locality: string | null;
  enriched_at: string | null;
  last_synced_at: string | null;
  journey_narrative: string | null;
  amendments_count: number | null;
  journey_analyzed_at: string | null;
  substance_targeting: SubstanceTargeting | null;
  substance_targeting_analyzed_at: string | null;
  summary_long: string | null;
  bill_text_versions: Array<{ label: string; date: string | null; text: string; source_url: string }> | null;
  text_synced_at: string | null;
  local_meta: LocalMeta | null;
  local_meta_extracted_at: string | null;
  opposition_summary_md: string | null;
  repeal_plan_md: string | null;
  forum_thread_id: string | null;
};

type Stance = "bans" | "restricts" | "schedules" | "preserves" | "neutral" | "unaddressed";
type SubstanceEntry = {
  stance: Stance;
  scope: string | null;
  schedule: string | null;
  confidence: number;
  notes: string;
};
type SubstanceTargeting = {
  natural_leaf: SubstanceEntry;
  mitragynine: SubstanceEntry;
  seven_oh: SubstanceEntry;
  pseudoindoxyl: SubstanceEntry;
  synthetic: SubstanceEntry;
};

const SUBSTANCE_LABEL: Record<keyof SubstanceTargeting, { name: string; abbrev?: string; tooltip: string }> = {
  natural_leaf: { name: "Natural leaf", tooltip: "Whole-leaf or traditional preparation (heating, water/ethanol extraction)" },
  mitragynine: { name: "Mitragynine", abbrev: "MGM", tooltip: "Dominant natural alkaloid (~1-2% of leaf weight)" },
  seven_oh: { name: "7-OH", tooltip: "7-hydroxymitragynine — natural trace alkaloid (~0.04% in fresh leaf)" },
  pseudoindoxyl: { name: "Pseudoindoxyl", abbrev: "Pseudo", tooltip: "Mitragynine pseudoindoxyl — oxidation metabolite, often semi-synthetic" },
  synthetic: { name: "Synthetic", tooltip: "Lab-synthesized or biosynthesized alkaloids (recombinant, fermentation, etc.)" },
};

const STANCE_STYLE: Record<Stance, { label: string; cls: string; emoji: string }> = {
  bans:        { label: "Bans",        cls: "border-red-700/50 bg-red-950/30 text-red-300",         emoji: "🚫" },
  restricts:   { label: "Restricts",   cls: "border-amber-700/50 bg-amber-950/30 text-amber-300",   emoji: "⚠" },
  schedules:   { label: "Schedules",   cls: "border-red-700/50 bg-red-950/30 text-red-300",         emoji: "🚫" },
  preserves:   { label: "Preserves",   cls: "border-emerald-700/50 bg-emerald-950/30 text-emerald-300", emoji: "✓" },
  neutral:     { label: "Neutral",     cls: "border-zinc-700 bg-zinc-950/40 text-zinc-400",         emoji: "·" },
  unaddressed: { label: "Unaddressed", cls: "border-zinc-800 bg-zinc-950/20 text-zinc-500",         emoji: "—" },
};

const RELEVANCE_STYLE: Record<string, { label: string; cls: string }> = {
  pro: { label: "Pro-kratom", cls: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40" },
  anti: { label: "Anti-kratom", cls: "bg-red-950/40 text-red-300 border-red-700/40" },
  neutral: { label: "Neutral", cls: "bg-zinc-900 text-zinc-400 border-zinc-700" },
};

// Bill stakeholders — people of interest beyond gov officials. Neutral tracker
// (mig 0243): each figure's documented position on the natural leaf and on 7-OH,
// with evidence. Public records (RLS "Public read bill stakeholders" = using(true)).
// Module-scoped so both the snapshot fetch and the render use one shape.
type StakeholderRow = {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  role_type: string;
  reasoning: string;
  leaf_stance: string | null;
  seven_oh_stance: string | null;
  leaf_evidence_url: string | null;
  seven_oh_evidence_url: string | null;
  stance_summary: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  twitter_handle: string | null;
  linkedin_url: string | null;
};

// ── Cached public snapshot ──────────────────────────────────────────────
// /bills/[id] is the biggest remaining crawl surface (676 pages). It mixes a
// large PUBLIC read-set (bill + sponsors + committee leverage + donors +
// clusters + research + news + campaigns + stakeholders + similar bills) with a
// few PER-VIEWER reads (auth, bill_subscriptions, the viewer's civic profile for
// federal delegation targeting, the self-scoped action count, translations).
// Only the public read-set is snapshotted here — ONE cached cookieless
// service-role read-set per bill id (the #827/#831/#832 egress pattern) instead
// of ~20 live DB reads on every visit/crawl. Per-viewer reads stay on the
// request-bound cookie client in the page body, uncached.
//
// Service-role bypasses RLS, so every public-visibility filter the cookie
// client relied on is re-applied here EXPLICITLY: approved policy_alerts +
// forum_threads, active campaigns + news_items, active research_papers. No
// profiles PII is placed in the snapshot (legislator/stakeholder contact fields
// are public records). unstable_cache keys on the id arg so each bill gets its
// own entry. generateMetadata shares the exact same snapshot.
const getBillPublicSnapshot = unstable_cache(
  async (id: string) => {
    const sb = createServiceRoleClient();

    const { data: billRaw } = await sb
      .from("bills")
      .select(
        "id, state, bill_number, title, summary, summary_ai, advocacy_callout, " +
        "status, kratom_relevance, relevance_confidence, last_action, last_action_at, " +
        "source_url, official_url, session_id, scope, locality, active, " +
        "enriched_at, last_synced_at, " +
        "journey_narrative, amendments_count, journey_analyzed_at, " +
        "substance_targeting, substance_targeting_analyzed_at, " +
        "summary_long, bill_text_versions, text_synced_at, " +
        "local_meta, local_meta_extracted_at, " +
        "opposition_summary_md, repeal_plan_md, " +
        "forum_thread_id",
      )
      .eq("id", id)
      .single();

    if (!billRaw) return null;
    const bill = billRaw as unknown as BillRow;

    // Separate fetch for the current_committee_* columns. Done as a
    // discrete query so the page degrades gracefully on environments
    // where migration 0123 hasn't been applied yet.
    let currentCommitteeName: string | null = null;
    try {
      const { data: extra } = await sb
        .from("bills")
        .select("current_committee_name")
        .eq("id", id)
        .single();
      if (extra && typeof (extra as { current_committee_name?: unknown }).current_committee_name === "string") {
        currentCommitteeName = (extra as { current_committee_name: string }).current_committee_name;
      }
    } catch {
      // Column doesn't exist yet — silent no-op.
    }

    // Bill stakeholders — people of interest beyond gov officials (public
    // records; RLS "Public read bill stakeholders" = using(true)). Defensive
    // so a pre-migration deploy falls through to empty. StakeholderRow is
    // module-scoped (shared with the render).
    let stakeholders: StakeholderRow[] = [];
    try {
      const { data } = await sb
        .from("bill_stakeholders")
        .select("id, name, title, organization, role_type, reasoning, leaf_stance, seven_oh_stance, leaf_evidence_url, seven_oh_evidence_url, stance_summary, email, phone, website, twitter_handle, linkedin_url")
        .eq("bill_id", id)
        .order("role_type", { ascending: true });
      stakeholders = (data ?? []) as StakeholderRow[];
    } catch {
      // Pre-migration deploy — silent.
    }

    // Phase 3 D6: cross-state bill similarity — already self-cached
    // (findSimilarBillsCached: own unstable_cache + service-role, 24h).
    let similarBills: Awaited<ReturnType<typeof findSimilarBillsCached>> = [];
    try {
      similarBills = await findSimilarBillsCached(id, { limit: 5, minSimilarity: 0.6 });
    } catch {
      // Pre-migration deploy or query error — silent fallback.
    }

    // Forum thread — approved-only replicates the forum_threads public RLS
    // (moderation_status='approved') the cookie client relied on.
    type ForumThreadSummary = {
      id: string;
      state: string | null;
      title: string;
      post_count: number;
      last_activity_at: string | null;
    };
    let forumThread: ForumThreadSummary | null = null;
    if (bill.forum_thread_id) {
      const { data } = await sb
        .from("forum_threads")
        .select("id, state, title, post_count, last_activity_at")
        .eq("id", bill.forum_thread_id)
        .eq("moderation_status", "approved")
        .maybeSingle();
      if (data) forumThread = data as unknown as ForumThreadSummary;
    }

    // Linked campaigns — active-only replicates the campaigns public RLS
    // (active=true) the cookie client relied on. (The admin-only "past
    // campaigns (inactive)" list is gated by admin/creator RLS and never
    // rendered for public viewers; it does not appear on the cached page.)
    const { data: campaignsRaw } = await sb
      .from("campaigns")
      .select("id, slug, title, active, auto_generated, created_at")
      .eq("bill_id", bill.id)
      .eq("active", true)
      .order("created_at", { ascending: false });
    const campaigns = (campaignsRaw ?? []) as Array<{
      id: string;
      slug: string;
      title: string;
      active: boolean;
      auto_generated: boolean;
      created_at: string;
    }>;

    // For municipal/county bills: fetch the full slate of local officials.
    const isLocalScope = bill.scope === "municipal" || bill.scope === "county";
    let localOfficials: LocalOfficial[] = [];
    if (isLocalScope && bill.locality) {
      const { data: legs } = await sb
        .from("legislators")
        .select("id, full_name, role, title, district, party, email, phone, website")
        .eq("state", bill.state)
        .eq("locality", bill.locality)
        .in("role", ["city_council", "mayor", "county_executive", "county_commissioner"])
        .eq("active", true)
        .order("role", { ascending: true });
      localOfficials = (legs ?? []) as LocalOfficial[];
    }

    // Alerts linked to this bill — approved-only replicates policy_alerts
    // public RLS.
    const { data: billAlertsRaw } = await sb
      .from("policy_alerts")
      .select("id, title, severity, kind, source_url, occurs_at, created_at")
      .eq("bill_id", bill.id)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(3);
    const billAlerts = (billAlertsRaw ?? []) as Array<{
      id: string; title: string; severity: string; kind: string;
      source_url: string | null; occurs_at: string | null; created_at: string;
    }>;
    const alertSourceUrl: string | null = isLocalScope
      ? (billAlerts[0]?.source_url ?? null)
      : null;

    // News coverage — union of direct bill_id linkage + policy_alert_id chain.
    // Both alert-id lookup (approved) and news (active) replicate public RLS.
    let newsCoverage: NewsItem[] = [];
    {
      const { data: linkedAlerts } = await sb
        .from("policy_alerts")
        .select("id")
        .eq("bill_id", bill.id)
        .eq("moderation_status", "approved");
      const linkedAlertIds = (linkedAlerts ?? []).map((a: { id: string }) => a.id);

      const orClauses = [`bill_id.eq.${bill.id}`];
      if (linkedAlertIds.length > 0) {
        orClauses.push(`policy_alert_id.in.(${linkedAlertIds.join(",")})`);
      }
      const { data: news } = await sb
        .from("news_items")
        .select("id, title, source_name, url, published_at, summary")
        .or(orClauses.join(","))
        .eq("active", true)
        .order("published_at", { ascending: false })
        .limit(80);
      newsCoverage = dedupNews((news ?? []) as NewsItem[], 12);
    }

    // Sponsors (synced into bill_sponsors, public read).
    const { data: sponsorsRaw } = await sb
      .from("bill_sponsors")
      .select("legislator_id, name, classification, party, district, legislators(full_name, portrait_url, role, party)")
      .eq("bill_id", bill.id)
      .order("classification", { ascending: true });
    type SponsorLeg = { full_name: string | null; portrait_url: string | null; role: string | null; party: string | null };
    const sponsors = (sponsorsRaw ?? []).map((s) => {
      const r = s as typeof s & { legislators: SponsorLeg | SponsorLeg[] | null };
      return { ...r, legislator: Array.isArray(r.legislators) ? r.legislators[0] ?? null : r.legislators };
    }) as Array<{
      legislator_id: string | null;
      name: string;
      classification: string;
      party: string | null;
      district: string | null;
      legislator: SponsorLeg | null;
    }>;

    // Aggregate donor industries across this bill's sponsors (legislator_donors
    // public read). Federal only in practice — state legislators lack donor data.
    type AggregatedIndustry = {
      industry: string;
      label: string;
      advocate_flag: boolean;
      amount: number;
      legislator_count: number;
    };
    let sponsorIndustryAgg: AggregatedIndustry[] = [];
    let sponsorsWithDonorData = 0;
    {
      const sponsorLegIds = sponsors
        .map((s) => s.legislator_id)
        .filter((legId): legId is string => !!legId);
      if (sponsorLegIds.length > 0) {
        const { data: donorRows } = await sb
          .from("legislator_donors")
          .select("legislator_id, top_industries, resolved_status")
          .in("legislator_id", sponsorLegIds)
          .eq("resolved_status", "matched");

        type IndustryRow = {
          industry: string;
          label?: string;
          advocate_flag?: boolean;
          amount: number;
        };
        const byIndustry = new Map<string, AggregatedIndustry>();
        for (const row of (donorRows ?? []) as Array<{
          legislator_id: string;
          top_industries: IndustryRow[] | null;
        }>) {
          if (!Array.isArray(row.top_industries) || row.top_industries.length === 0) {
            continue;
          }
          sponsorsWithDonorData++;
          const seenThisSponsor = new Set<string>();
          for (const ind of row.top_industries) {
            if (!ind.industry || typeof ind.amount !== "number") continue;
            const cur = byIndustry.get(ind.industry) ?? {
              industry: ind.industry,
              label: ind.label ?? ind.industry,
              advocate_flag: !!ind.advocate_flag,
              amount: 0,
              legislator_count: 0,
            };
            cur.amount += ind.amount;
            if (!seenThisSponsor.has(ind.industry)) {
              cur.legislator_count += 1;
              seenThisSponsor.add(ind.industry);
            }
            byIndustry.set(ind.industry, cur);
          }
        }
        sponsorIndustryAgg = [...byIndustry.values()]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 12);
      }
    }

    // ── Committee leverage — every member of the committee where this bill
    // sits, ranked by threat-matrix tier. All source tables are public read.
    type CommitteeMember = {
      legislator_id: string;
      full_name: string;
      state: string;
      role: string;
      district: string | null;
      party: string | null;
      phone: string | null;
      email: string | null;
      website: string | null;
      title: string | null;
      committee_role: string; // chair / vice_chair / member
      tier: string;
      tier_label: string;
      tier_emoji: string;
      tier_color: string;
      threat_score: number;
      vulnerability_score: number;
      has_anti_sponsorship: boolean;
      has_pro_sponsorship: boolean;
      rationale: string;
    };
    const committeeMembers: CommitteeMember[] = [];
    if (currentCommitteeName && bill.state) {
      try {
        const { assessThreat } = await import("@/lib/legislator-threat-score");
        const { committeesMatch } = await import("@/lib/bill-committee");
        const { data: stateCommittees } = await sb
          .from("legislator_committees")
          .select("legislator_id, committee_name, role, is_kratom_relevant, legislators!inner(id, full_name, state, role, district, party, phone, email, website, title, active)")
          .eq("legislators.state", bill.state)
          .eq("legislators.active", true)
          .limit(2000);
        type CmtRow = {
          legislator_id: string;
          committee_name: string;
          role: string;
          is_kratom_relevant: boolean | null;
          legislators: {
            id: string; full_name: string; state: string; role: string;
            district: string | null; party: string | null;
            phone: string | null; email: string | null;
            website: string | null; title: string | null; active: boolean;
          } | Array<{ id: string; full_name: string; state: string; role: string; district: string | null; party: string | null; phone: string | null; email: string | null; website: string | null; title: string | null; active: boolean }> | null;
        };
        const matched = ((stateCommittees ?? []) as CmtRow[]).filter((c) =>
          committeesMatch(currentCommitteeName!, c.committee_name),
        );
        if (matched.length > 0) {
          const memberIds = matched.map((c) => c.legislator_id);
          const [stancesRes, sponsorsRes, donorsRes, tradesRes] = await Promise.all([
            sb.from("legislator_stance").select("legislator_id, stance").eq("topic", "kratom").in("legislator_id", memberIds),
            sb.from("bill_sponsors")
              .select("legislator_id, classification, bills!inner(kratom_relevance, active)")
              .in("legislator_id", memberIds)
              .eq("bills.active", true),
            sb.from("legislator_donors")
              .select("legislator_id, top_industries")
              .in("legislator_id", memberIds)
              .eq("resolved_status", "matched"),
            sb.from("federal_personal_trades")
              .select("legislator_id")
              .in("legislator_id", memberIds)
              .eq("is_kratom_adjacent", true),
          ]);
          const stanceByLeg = new Map<string, string>();
          for (const r of (stancesRes.data ?? []) as Array<{ legislator_id: string; stance: string }>) {
            stanceByLeg.set(r.legislator_id, r.stance);
          }
          type SpAgg = {
            primary_count: number; cosponsor_count: number;
            has_anti: boolean; has_pro: boolean; anti_primary: number; pro_primary: number;
          };
          const spByLeg = new Map<string, SpAgg>();
          for (const s of (sponsorsRes.data ?? []) as Array<{ legislator_id: string; classification: string; bills: { kratom_relevance: string | null } | Array<{ kratom_relevance: string | null }> | null }>) {
            const b = Array.isArray(s.bills) ? s.bills[0] : s.bills;
            if (!b) continue;
            const agg = spByLeg.get(s.legislator_id) ?? { primary_count: 0, cosponsor_count: 0, has_anti: false, has_pro: false, anti_primary: 0, pro_primary: 0 };
            if (s.classification === "primary") {
              agg.primary_count++;
              if (b.kratom_relevance === "anti") agg.anti_primary++;
              if (b.kratom_relevance === "pro") agg.pro_primary++;
            } else { agg.cosponsor_count++; }
            if (b.kratom_relevance === "anti") agg.has_anti = true;
            if (b.kratom_relevance === "pro") agg.has_pro = true;
            spByLeg.set(s.legislator_id, agg);
          }
          const donorsByLeg = new Map<string, Array<{ industry: string; amount: number; advocate_flag?: boolean }>>();
          for (const d of (donorsRes.data ?? []) as Array<{ legislator_id: string; top_industries: Array<{ industry: string; amount: number; advocate_flag?: boolean }> | null }>) {
            if (d.top_industries) donorsByLeg.set(d.legislator_id, d.top_industries);
          }
          const tradesByLeg = new Map<string, number>();
          for (const t of (tradesRes.data ?? []) as Array<{ legislator_id: string }>) {
            tradesByLeg.set(t.legislator_id, (tradesByLeg.get(t.legislator_id) ?? 0) + 1);
          }

          for (const c of matched) {
            const l = Array.isArray(c.legislators) ? c.legislators[0] : c.legislators;
            if (!l) continue;
            const isFederalLeg = l.role === "us_senate" || l.role === "us_house";
            const stance = (stanceByLeg.get(c.legislator_id) ?? "unknown") as
              "champion" | "sympathetic" | "neutral" | "hostile" | "unknown";
            const sp = spByLeg.get(c.legislator_id);
            const inds = donorsByLeg.get(c.legislator_id) ?? [];
            function indAmt(name: string) {
              if (!isFederalLeg) return null;
              const row = inds.find((i) => i.industry === name);
              return row?.amount ?? 0;
            }
            const assess = assessThreat({
              stance,
              has_anti_sponsorship: !!sp?.has_anti,
              has_pro_sponsorship: !!sp?.has_pro,
              primary_sponsorship_count: sp?.anti_primary ?? 0,
              cosponsorship_count: sp?.cosponsor_count ?? 0,
              is_chair_of_kratom_relevant: c.role === "chair" && !!c.is_kratom_relevant,
              is_member_of_kratom_relevant: !!c.is_kratom_relevant,
              bills_in_their_committees: 1, // this very bill
              pharma_usd: indAmt("pharma_biotech"),
              alcohol_usd: indAmt("alcohol"),
              tobacco_usd: indAmt("tobacco_nicotine"),
              addiction_treatment_usd: indAmt("addiction_treatment"),
              cannabis_usd: indAmt("cannabis"),
              gaming_usd: indAmt("gaming_casino"),
              hospital_health_usd: indAmt("hospital_health"),
              kratom_adjacent_trade_count: isFederalLeg ? (tradesByLeg.get(c.legislator_id) ?? 0) : null,
            });
            committeeMembers.push({
              legislator_id: c.legislator_id,
              full_name: l.full_name,
              state: l.state,
              role: l.role,
              district: l.district,
              party: l.party,
              phone: l.phone,
              email: l.email,
              website: l.website,
              title: l.title,
              committee_role: c.role,
              tier: assess.tier,
              tier_label: assess.tier_label,
              tier_emoji: assess.tier_emoji,
              tier_color: assess.tier_color,
              threat_score: assess.threat_score,
              vulnerability_score: assess.vulnerability_score,
              has_anti_sponsorship: !!sp?.has_anti,
              has_pro_sponsorship: !!sp?.has_pro,
              rationale: assess.rationale,
            });
          }
          const TIER_ORDER_LOCAL: Record<string, number> = {
            active_opponent: 0, hostile_decision_maker: 1, flippable_target: 2,
            champion: 3, sympathetic_ally: 4, education_target: 5, low_priority: 6,
          };
          committeeMembers.sort((a, b) => {
            if (a.committee_role === "chair" && b.committee_role !== "chair") return -1;
            if (b.committee_role === "chair" && a.committee_role !== "chair") return 1;
            const ta = TIER_ORDER_LOCAL[a.tier] ?? 9;
            const tb = TIER_ORDER_LOCAL[b.tier] ?? 9;
            if (ta !== tb) return ta - tb;
            return b.threat_score - a.threat_score;
          });
        }
      } catch {
        // bill-committee lib or threat-score lib unavailable — silent.
      }
    }

    // ── Cluster memberships — coordinated-operation patterns this bill matches.
    type ClusterMembership = {
      cluster_id: string;
      confidence: number;
      match_reason: string | null;
      slug: string;
      name: string;
      posture: string;
      bill_count: number;
      state_count: number;
    };
    let billClusterMemberships: ClusterMembership[] = [];
    try {
      const { data: memberships } = await sb
        .from("bill_cluster_members")
        .select("cluster_id, confidence, match_reason, bill_clusters!inner(slug, name, posture, bill_count, state_count)")
        .eq("bill_id", bill.id);
      type M = {
        cluster_id: string; confidence: number; match_reason: string | null;
        bill_clusters: { slug: string; name: string; posture: string; bill_count: number; state_count: number }
                     | Array<{ slug: string; name: string; posture: string; bill_count: number; state_count: number }>
                     | null;
      };
      for (const m of (memberships ?? []) as M[]) {
        const c = Array.isArray(m.bill_clusters) ? m.bill_clusters[0] : m.bill_clusters;
        if (!c) continue;
        billClusterMemberships.push({
          cluster_id: m.cluster_id,
          confidence: m.confidence,
          match_reason: m.match_reason,
          slug: c.slug,
          name: c.name,
          posture: c.posture,
          bill_count: c.bill_count,
          state_count: c.state_count,
        });
      }
      billClusterMemberships.sort((a, b) => b.confidence - a.confidence);
    } catch {
      // Pre-migration deploy (before 0151) — silent empty.
      billClusterMemberships = [];
    }

    // Scientific basis — research_papers.is_active=true replicates the
    // "Public read active research" RLS (service-role bypasses it otherwise).
    type ResearchAlignment = {
      paper_id: string;
      relevance_score: number;
      match_reason: string;
      alignment: "aligned" | "contradictory" | "context";
      title: string;
      journal: string | null;
      publication_year: number | null;
      pubmed_id: string | null;
      doi: string | null;
      ai_evidence_strength: string | null;
      ai_key_findings_md: string | null;
    };
    let researchAlignments: ResearchAlignment[] = [];
    try {
      const { data: alignmentRows } = await sb
        .from("bill_research_alignment")
        .select("paper_id, relevance_score, match_reason, alignment, research_papers!inner(title, journal, publication_year, pubmed_id, doi, ai_evidence_strength, ai_key_findings_md, is_active)")
        .eq("bill_id", bill.id)
        .eq("research_papers.is_active", true)
        .order("relevance_score", { ascending: false })
        .limit(6);
      type Row = {
        paper_id: string; relevance_score: number; match_reason: string;
        alignment: "aligned" | "contradictory" | "context";
        research_papers: { title: string; journal: string | null; publication_year: number | null; pubmed_id: string | null; doi: string | null; ai_evidence_strength: string | null; ai_key_findings_md: string | null }
                       | Array<{ title: string; journal: string | null; publication_year: number | null; pubmed_id: string | null; doi: string | null; ai_evidence_strength: string | null; ai_key_findings_md: string | null }>
                       | null;
      };
      for (const r of (alignmentRows ?? []) as Row[]) {
        const p = Array.isArray(r.research_papers) ? r.research_papers[0] : r.research_papers;
        if (!p) continue;
        researchAlignments.push({
          paper_id: r.paper_id,
          relevance_score: r.relevance_score,
          match_reason: r.match_reason,
          alignment: r.alignment,
          title: p.title,
          journal: p.journal,
          publication_year: p.publication_year,
          pubmed_id: p.pubmed_id,
          doi: p.doi,
          ai_evidence_strength: p.ai_evidence_strength,
          ai_key_findings_md: p.ai_key_findings_md,
        });
      }
    } catch {
      // Pre-migration (before 0154) — silent empty.
      researchAlignments = [];
    }

    // Momentum — pure heuristic over the snapshot's own aggregates.
    const momentum = computeBillMomentum({
      last_action_at: bill.last_action_at ?? null,
      status: bill.status ?? null,
      current_committee_name: currentCommitteeName,
      sponsor_count: sponsors.length,
      cluster_count: billClusterMemberships.length,
      recent_news_mentions: newsCoverage.length,
      active: bill.active !== false,
    });

    // Similar bills: same stance + active + last 365 days, excluding this bill.
    // The 365-day window anchors to snapshot-fill time (≤15-min drift).
    const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
    const { data: similarRaw } = bill.kratom_relevance
      ? await sb
          .from("bills")
          .select("id, state, bill_number, title, status, last_action_at, scope")
          .eq("kratom_relevance", bill.kratom_relevance)
          .eq("active", true)
          .neq("id", bill.id)
          .gte("last_action_at", since)
          .order("last_action_at", { ascending: false })
          .limit(8)
      : { data: [] };
    const similar = (similarRaw ?? []) as Array<{
      id: string; state: string; bill_number: string; title: string | null;
      status: string | null; last_action_at: string | null; scope: string | null;
    }>;

    // Bill-level "email your officials" targeting is viewer-INDEPENDENT for
    // state/exec bills (whole-chamber + executive trio → public legislators),
    // so it's snapshotted here. Federal bills need the viewer's delegation, so
    // that branch stays request-bound in the page body (viewerCivic). Local
    // scope uses BillLocalActionCard instead → null here.
    const isFederalBill = bill.scope === "federal" || bill.state === "US";
    let officialGroups: BillOfficialGroups | null = null;
    if (!isLocalScope && !isFederalBill) {
      officialGroups = await getBillOfficialGroups(sb, { state: bill.state, scope: bill.scope }, null);
    }

    return {
      bill,
      currentCommitteeName,
      stakeholders,
      similarBills,
      forumThread,
      campaigns,
      localOfficials,
      billAlerts,
      alertSourceUrl,
      newsCoverage,
      sponsors,
      sponsorIndustryAgg,
      sponsorsWithDonorData,
      committeeMembers,
      billClusterMemberships,
      researchAlignments,
      similar,
      momentum,
      officialGroups,
    };
  },
  ["bill-detail"],
  { revalidate: 900, tags: ["bill-detail"] },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Bill" };
  const snap = await getBillPublicSnapshot(id);
  if (!snap) return { title: "Bill" };
  const data = snap.bill;
  const stance = data.kratom_relevance === "anti"
    ? "kratom-hostile" : data.kratom_relevance === "pro" ? "kratom-supportive" : "kratom-neutral";
  const title = `${data.state} ${data.bill_number} — ${data.title?.slice(0, 80) ?? ""}`;
  const description = (data.summary_ai ?? data.summary ?? "").slice(0, 200) ||
    `${data.state} bill ${data.bill_number}, ${stance}. Status: ${data.status ?? "tracking"}. Tracked live on iKratom.`;
  const url = `${(process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "")}/bills/${id}`;

  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: "iKratom",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: { canonical: url },
  };
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Validate the id BEFORE touching the cache so random-uuid crawls can't
  // seed junk cache entries.
  if (!UUID_RE.test(id)) notFound();
  const snap = await getBillPublicSnapshot(id);
  if (!snap) notFound();
  const {
    bill,
    currentCommitteeName,
    stakeholders,
    similarBills,
    forumThread,
    campaigns,
    localOfficials,
    billAlerts,
    alertSourceUrl,
    newsCoverage,
    sponsors,
    sponsorIndustryAgg,
    sponsorsWithDonorData,
    committeeMembers,
    billClusterMemberships,
    researchAlignments,
    similar,
    momentum,
    officialGroups: officialGroupsPublic,
  } = snap;

  // ── Per-viewer reads (request-bound cookie client, never cached) ──
  const supabase = await createClient();

  // Signed-in state + whether the viewer already subscribes to this bill,
  // so the "🔔 Notify me" button renders in the right state.
  const { data: { user: viewer } } = await supabase.auth.getUser();
  const viewerSignedIn = !!viewer;
  let initiallySubscribed = false;
  if (viewer) {
    const { data: sub } = await supabase
      .from("bill_subscriptions")
      .select("user_id")
      .eq("user_id", viewer.id)
      .eq("bill_id", bill.id)
      .maybeSingle();
    initiallySubscribed = !!sub;
  }

  // Federal "email your officials" targeting needs the viewer's own districts,
  // so the civic profile (PII) + the delegation resolution stay per-viewer.
  // State/exec bills use the viewer-independent groups from the snapshot.
  const isFederalBill = bill.scope === "federal" || bill.state === "US";
  let viewerCivic: {
    state: string | null; congressional_district: string | null;
    state_senate_district: string | null; state_house_district: string | null;
    city: string | null; county: string | null;
  } | null = null;
  if (viewer && isFederalBill) {
    const { data: cp } = await supabase
      .from("profiles")
      .select("state, congressional_district, state_senate_district, state_house_district, city, county")
      .eq("id", viewer.id)
      .single();
    viewerCivic = cp ?? null;
  }
  const officialGroups = isFederalBill
    ? await getBillOfficialGroups(supabase, { state: bill.state, scope: bill.scope }, viewerCivic)
    : officialGroupsPublic;
  const billStance: "oppose" | "support" | "neutral" =
    bill.kratom_relevance === "anti" ? "oppose" : bill.kratom_relevance === "pro" ? "support" : "neutral";

  // Action count across all campaigns for this bill. RLS on campaign_actions
  // is self-scoped (auth.uid() = user_id), so this stays on the cookie client
  // (a cached service-role count would change the number a viewer sees).
  // head:true → count only, no row payload.
  const { count: totalActions } = campaigns.length > 0
    ? await supabase
        .from("campaign_actions")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", campaigns.map((c) => c.id))
    : { count: 0 };

  // Live fetch from OpenStates — cached 1 hour in its own lib (external API,
  // not Supabase egress). Skip for non-state scopes (no county/municipal cover).
  const isLocal = bill.scope === "county" || bill.scope === "municipal";
  const detail = isLocal
    ? null
    : await fetchOpenStatesBillDetail(bill.state, bill.bill_number);

  // Staleness assessment — live now() so the "closed session" warning is
  // accurate regardless of the snapshot's revalidate window.
  const lastActionMs = bill.last_action_at ? new Date(bill.last_action_at).getTime() : null;
  const daysSinceAction = lastActionMs
    ? Math.floor((Date.now() - lastActionMs) / 86400_000)
    : null;
  const isStale = daysSinceAction != null && daysSinceAction > 365;

  const relevance = RELEVANCE_STYLE[bill.kratom_relevance ?? "neutral"] ?? RELEVANCE_STYLE.neutral;
  const status = billStatusLabel(bill.status);

  // schema.org Legislation — when AI agents answer 'what's NY S 1234?',
  // this gives them a structured record (jurisdiction, status, last
  // action, dates) to cite rather than paraphrasing the page text.
  const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
  const stanceLabel = bill.kratom_relevance === "anti"
    ? "Restrictive"
    : bill.kratom_relevance === "pro"
    ? "Supportive"
    : "Neutral";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Legislation",
    "@id": `${SITE}/bills/${bill.id}`,
    name: `${bill.state} ${bill.bill_number}`,
    legislationIdentifier: `${bill.state} ${bill.bill_number}`,
    legislationJurisdiction: {
      "@type": "AdministrativeArea",
      name: bill.state,
      addressCountry: "US",
    },
    ...(bill.title ? { headline: bill.title } : {}),
    ...(bill.title ? { description: bill.title.slice(0, 500) } : {}),
    ...(bill.last_action_at ? { datePublished: bill.last_action_at } : {}),
    ...(bill.last_action_at ? { dateModified: bill.last_action_at } : {}),
    ...(bill.status ? { legislationType: bill.status } : {}),
    isAccessibleForFree: true,
    keywords: ["kratom", "policy", bill.state, bill.kratom_relevance, stanceLabel.toLowerCase()].filter(Boolean).join(", "),
    publisher: { "@type": "Organization", name: "iKratom", url: SITE },
    url: `${SITE}/bills/${bill.id}`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE}/bills/${bill.id}` },
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }}
      />
      <div className="flex items-center justify-between gap-2">
        <a href={`/bills?state=${bill.state}`} className="text-xs text-zinc-500 hover:text-emerald-400">
          ← All {bill.state} bills
        </a>
        <div className="flex items-center gap-2">
          <RemindMeButton
            targetKind="bill"
            targetId={bill.id}
            defaultTitle={`${bill.state} ${bill.bill_number}: ${(bill.title ?? "follow up").slice(0, 60)}`}
            defaultMessage="Check status / contact rep"
          />
          <Link
            href={`/bills/${bill.id}/dossier`}
            className="rounded border border-emerald-700/40 bg-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-950/30"
            title="Printable citation-ready 1-page intel dossier — for journalists, agency staffers, advocates"
          >
            📄 Print dossier
          </Link>
          <PageShareWithAttribution
            path={`/bills/${bill.id}`}
            title={`${bill.state} ${bill.bill_number}: ${bill.title?.slice(0, 80) ?? "(no title)"}`}
            summary={(bill.summary_ai ?? bill.summary ?? "").slice(0, 180) || `Tracked on iKratom — ${bill.state} bill ${bill.bill_number}.`}
          />
        </div>
      </div>

      {/* Header */}
      <header className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-1 font-mono text-zinc-300">
            {bill.state} · {bill.bill_number}
          </span>
          {bill.scope && bill.scope !== "state" && (
            <span className="rounded bg-purple-950/40 px-2 py-1 capitalize text-purple-300">
              {bill.scope}
            </span>
          )}
          {bill.locality && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-300">
              📍 {bill.locality}
            </span>
          )}
          {bill.session_id && (
            <span
              className="rounded bg-zinc-900 px-2 py-1 text-zinc-400"
              title="Legislative session this bill belongs to"
            >
              Session {bill.session_id}
            </span>
          )}
          <span className={`rounded border px-2 py-1 font-semibold ${relevance.cls}`}>
            {relevance.label}
          </span>
          {bill.relevance_confidence != null && (
            <span className="text-zinc-500">
              {Math.round(bill.relevance_confidence * 100)}% confidence
            </span>
          )}
          {status && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">{status}</span>
          )}
          <span
            className={`rounded border px-2 py-1 font-semibold ${MOMENTUM_TONE[momentum.label]}`}
            title={`${momentum.rationale} (score: ${momentum.score}/100)`}
          >
            {MOMENTUM_LABEL[momentum.label]}
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">
          {displayTitle(bill.title, 120)}
        </h1>
        {displaySubtitle(bill.title) && (
          <p className="mt-1 text-sm text-zinc-400 leading-snug">
            {displaySubtitle(bill.title)}
          </p>
        )}
        {bill.last_action_at && (
          <p className="mt-2 text-sm text-zinc-500">
            Last action <span className="text-zinc-300">{new Date(bill.last_action_at).toLocaleDateString()}</span>
            {daysSinceAction != null && daysSinceAction > 0 && (
              <span className="text-zinc-600"> · {daysSinceAction} days ago</span>
            )}
          </p>
        )}
      </header>

      {/* Active battle hero — shows prominently when this is an
          ongoing anti-kratom fight at the local level. Suffolk's
          tabled-resolution case is the prototype. */}
      {bill.kratom_relevance === "anti"
        && (bill.scope === "county" || bill.scope === "municipal")
        && (bill.status === "committee" || bill.status === "introduced") && (
        <section className="mb-6 rounded-lg border-2 border-red-600/60 bg-red-950/25 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">⚠ Active battle</p>
          <h2 className="mt-1 text-lg font-bold text-zinc-100">
            {bill.locality ?? bill.state} kratom ban — fight is ongoing
          </h2>
          {bill.last_action && (
            <p className="mt-2 text-sm text-zinc-300">
              <span className="text-zinc-500">Most recent:</span> {bill.last_action}
            </p>
          )}
          <p className="mt-2 text-[12px] text-zinc-400">
            This is an active local-level kratom-restriction fight. The sponsors are listed below;
            the &quot;Take action&quot; section has emails and call scripts; and the &quot;People of interest&quot; section
            below names experts, journalists, and allies who can amplify a counter-narrative.
            {bill.locality?.includes("Suffolk") && " — Vote was tabled; we are watching the next General Meeting agenda automatically."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RemindMeButton
              targetKind="bill"
              targetId={bill.id}
              defaultTitle={`Check ${bill.state} ${bill.bill_number} status`}
              defaultMessage={`Tabled / pending. Re-check site for next-meeting date.`}
            />
            <IntelTipForm
              billId={bill.id}
              billTitle={bill.title ?? bill.bill_number}
              billState={bill.state}
              billLocality={bill.locality}
            />
          </div>
        </section>
      )}

      {/* Signup nudge for anonymous visitors. Bills are high-intent
          — someone reading a specific bill detail is the ideal target
          for "get pushed when this bill changes status". */}
      <SignUpNudge context="bill" stateCode={bill.state} className="mb-6" />
      <EnablePushNudge context="bill" stateCode={bill.state} className="mb-6" />

      {/* Takeback playbook — editorial content for enacted-ban + imminent-ban
          bills. Two sections: who pushed the ban (opposition_summary_md) and
          the concrete plan to repeal (repeal_plan_md). Rendered as a single
          composite section so the analytical context and the action plan stay
          adjacent. Only fires when at least one column is populated, which is
          by-design only for the 7 banning states + imminent TN. */}
      {(bill.opposition_summary_md || bill.repeal_plan_md) && (
        <details open className="group mb-6 rounded-lg border-2 border-amber-700/40 bg-gradient-to-br from-zinc-950/60 to-amber-950/15 p-5">
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2 [&::-webkit-details-marker]:hidden">
            <span className="inline-block text-[10px] text-amber-300/70 transition-transform group-open:rotate-90">▸</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
              🎯 Takeback intel
            </span>
            <span className="text-[10px] text-zinc-500">
              who pushed this · what the political trail looks like · how to repeal
            </span>
          </summary>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
            Editorial-curated political-action intel for this {bill.status === "enacted" ? "enacted ban" : "imminent ban"}. Sources, named legislators, and a phased repeal plan. Most of the work of repealing a state ban is naming the right allies and constraints — that&apos;s what this section is for.
          </p>

          {bill.opposition_summary_md && (
            <div className="mt-4 rounded-md border border-red-800/40 bg-red-950/15 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-red-300">
                  ⚠ Who pushed this ban
                </p>
                <AudioReader
                  id={`bill-${bill.id}-opposition`}
                  text={mdToPlainText(bill.opposition_summary_md)}
                  label="Listen"
                  compact
                />
              </div>
              <Markdown>{bill.opposition_summary_md}</Markdown>
            </div>
          )}

          {bill.repeal_plan_md && (
            <div className="mt-4 rounded-md border border-emerald-800/40 bg-emerald-950/15 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                  🛠 Repeal action plan
                </p>
                <AudioReader
                  id={`bill-${bill.id}-repeal`}
                  text={mdToPlainText(bill.repeal_plan_md)}
                  label="Listen"
                  compact
                />
              </div>
              <Markdown>{bill.repeal_plan_md}</Markdown>
            </div>
          )}

          <p className="mt-4 text-[10px] uppercase tracking-wider text-zinc-600">
            Editorial — submit corrections + additional intel via the &quot;Add local intel&quot; button on the people-of-interest section below.
          </p>
        </details>
      )}

      {/* "YOUR REP IS DECIDING THIS BILL" — district-level urgency.
          When the bill is in a committee that one of the user's reps
          sits on, this is the highest-leverage moment for that user.
          Renders silently when not applicable (no committee data,
          not signed in, wrong state, no rep match). */}
      <YourRepDecidingThisBill
        billId={bill.id}
        billState={bill.state}
        currentCommitteeName={currentCommitteeName}
      />

      {/* Per-bill timeline — surfaces the legislative-journey stage tracker
          + full action history. Lobbyists know the planned next-step
          calendar; this gives advocates the same intel + a status badge. */}
      <BillTimeline billId={bill.id} currentStatus={bill.status} billActive={(bill as { active?: boolean | null }).active === true} />

      {/* Stale warning — most important for SB-1639-style problems */}
      {isStale && (
        <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm">
          <p className="font-semibold text-amber-300">
            ⚠ This bill appears to be from a closed legislative session
          </p>
          <p className="mt-1 text-amber-200/80">
            No legislative activity in {daysSinceAction} days. Most US state sessions
            run 12 months or less, so a bill silent for over a year has almost
            certainly died when its session ended. Emailing legislators about
            dead bills wastes their attention. Verify with the official source
            below before taking action — and if a successor bill exists in the
            current session, search for that instead.
          </p>
        </div>
      )}

      {/* Local action playbook — for city/county ordinances where the
          intel didn't come from LegiScan. Calendar buttons, mailto:
          public-comment links, dial-in numbers, join URLs, officials.
          Renders only when scope is municipal/county AND the AI
          extractor populated local_meta. State bills skip this and go
          straight to Substance Impact. */}
      {(bill.scope === "municipal" || bill.scope === "county") && bill.local_meta && (
        <BillLocalActionCard
          meta={bill.local_meta}
          billId={bill.id}
          billTitle={bill.title ?? ""}
          billState={bill.state}
          billLocality={bill.locality}
          agendaItemNumber={bill.local_meta.agenda_item_number}
          officials={localOfficials}
          sourceUrl={alertSourceUrl}
          signedIn={viewerSignedIn}
          initiallySubscribed={initiallySubscribed}
        />
      )}

      {/* Substance impact — per-alkaloid stance. Placed FIRST because
          the most common reader question is "does this bill affect
          plain leaf or just 7-OH?" and we want them to see the answer
          before any prose. Five fixed substance classes ensure the
          rendering is consistent across every bill. */}
      {bill.substance_targeting && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Substance impact
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">
              what each part of the kratom umbrella sees
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(Object.keys(SUBSTANCE_LABEL) as Array<keyof SubstanceTargeting>).map((k) => {
              const entry = bill.substance_targeting?.[k];
              if (!entry) return null;
              const meta = SUBSTANCE_LABEL[k];
              const style = STANCE_STYLE[entry.stance] ?? STANCE_STYLE.unaddressed;
              return (
                <div
                  key={k}
                  className={`rounded-md border p-3 ${style.cls}`}
                  title={meta.tooltip}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold">
                      {meta.name}
                      {meta.abbrev && (
                        <span className="ml-1 text-[10px] opacity-70">({meta.abbrev})</span>
                      )}
                    </span>
                    <span className="text-base leading-none">{style.emoji}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono uppercase tracking-wider opacity-80">
                    {style.label}
                    {entry.schedule && entry.schedule !== "-" && (
                      <span className="ml-1">· Sch. {entry.schedule}</span>
                    )}
                  </div>
                  {entry.scope && entry.scope !== "-" && entry.stance !== "unaddressed" && (
                    <div className="mt-0.5 text-[10px] opacity-70">
                      {entry.scope.replace(/_/g, " ")}
                    </div>
                  )}
                  {entry.notes && (
                    <p className="mt-1.5 text-[10px] leading-snug opacity-75">{entry.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
            AI-classified per-alkaloid stance.{" "}
            {bill.substance_targeting_analyzed_at && (
              <>Analyzed {new Date(bill.substance_targeting_analyzed_at).toLocaleDateString()}.</>
            )}{" "}
            <span className="normal-case tracking-normal">
              We distinguish natural leaf, MGM, 7-OH, pseudoindoxyl, and synthetic
              derivatives — &ldquo;kratom&rdquo; alone is too coarse.
            </span>
          </p>
        </section>
      )}

      {/* Cumulative journey — when the bill has been amended at least
          once, show the full trajectory (introduced → each amendment →
          current state → cumulative impact). */}
      {bill.journey_narrative && (bill.amendments_count ?? 0) >= 2 && (
        <details open className="group mb-6 rounded-lg border border-emerald-900/40 bg-gradient-to-br from-zinc-950/40 to-emerald-950/10 p-5">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="inline-block text-[10px] text-emerald-300/70 transition-transform group-open:rotate-90">▸</span>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
              Bill journey
            </h2>
            <span className="rounded-full bg-emerald-950/40 px-2 py-0.5 text-[10px] font-mono uppercase text-emerald-300">
              {bill.amendments_count} versions tracked
            </span>
          </summary>
          <p className="mb-3 mt-3 text-[11px] text-zinc-500">
            How the bill evolved from introduction through every amendment to the current
            text. Helps you see what was kept, removed, and added — instead of only
            reading the latest snapshot.
          </p>
          <div className="mb-3">
            <AudioReader
              id={`bill-${bill.id}-journey`}
              text={mdToPlainText(bill.journey_narrative)}
              label="Listen"
              compact
            />
          </div>
          <div className="space-y-3 text-sm leading-relaxed text-zinc-200">
            {bill.journey_narrative
              .split(/\n\s*\n/)
              .filter((p) => p.trim().length > 0)
              .map((para, i) => (
                <p key={i}>{para.trim()}</p>
              ))}
          </div>
          {bill.journey_analyzed_at && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              AI-synthesized from action timeline + version texts ·{" "}
              last analyzed {new Date(bill.journey_analyzed_at).toLocaleDateString()}
            </p>
          )}
        </details>
      )}

      {/* Substantive briefing-grade summary (200-300 words). When
          present, this REPLACES the 2-sentence summary_ai because it
          covers everything the short version did and more. */}
      {bill.summary_long ? (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Briefing
            </h2>
            <AudioReader id={`bill-${bill.id}-briefing`} text={mdToPlainText(bill.summary_long)} label="Listen" compact />
          </div>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-200">
            {bill.summary_long
              .split(/\n\s*\n/)
              .filter((p) => p.trim().length > 0)
              .map((para, i) => (
                <p key={i}>{para.trim()}</p>
              ))}
          </div>
          {bill.advocacy_callout && (
            <div className="mt-4 rounded-md border border-emerald-900/30 bg-emerald-950/20 p-3">
              <p className="text-xs font-semibold text-emerald-400">For advocates:</p>
              <TranslatedSection
                type="bill_callout"
                id={bill.id}
                sourceText={bill.advocacy_callout}
                className="mt-1 text-sm text-emerald-200"
              />
            </div>
          )}
          {bill.journey_analyzed_at && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              AI-summarized · last reviewed {new Date(bill.journey_analyzed_at).toLocaleDateString()}
            </p>
          )}
        </section>
      ) : bill.summary_ai && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Plain English
            </h2>
            <AudioReader id={`bill-${bill.id}-summary`} text={mdToPlainText(bill.summary_ai)} label="Listen" compact />
          </div>
          {(() => {
            // Note: this IIFE inside JSX is server-side; await is fine.
            return null;
          })()}
          {/* The actual translated content is fetched + rendered below */}
          <TranslatedSection
            type="bill_summary"
            id={bill.id}
            sourceText={bill.summary_ai}
          />
          {bill.advocacy_callout && (
            <div className="mt-4 rounded-md border border-emerald-900/30 bg-emerald-950/20 p-3">
              <p className="text-xs font-semibold text-emerald-400">For advocates:</p>
              <TranslatedSection
                type="bill_callout"
                id={bill.id}
                sourceText={bill.advocacy_callout}
                className="mt-1 text-sm text-emerald-200"
              />
            </div>
          )}
          {bill.enriched_at && (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              AI-summarized · last reviewed {new Date(bill.enriched_at).toLocaleDateString()}
            </p>
          )}
        </section>
      )}

      {/* ── Action + reference group: Take action / past campaigns /
          official abstracts / official versions — placed ABOVE the full
          bill text per owner spec (2026-06-11), reference boxes
          collapsible for small screens. ── */}

      {/* Linked campaigns */}
      {campaigns.length > 0 && campaigns.some((c) => c.active) && (
        <section className="mb-6 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Take action
          </h2>
          <ul className="mt-3 space-y-2">
            {campaigns
              .filter((c) => c.active)
              .map((c) => (
                <li key={c.id}>
                  <a
                    href={`/campaigns/${c.slug}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 hover:border-emerald-500"
                  >
                    <span className="text-sm font-medium text-zinc-100">{c.title}</span>
                    <span className="text-xs text-emerald-300">Open campaign →</span>
                  </a>
                </li>
              ))}
          </ul>
          {(totalActions ?? 0) > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              {totalActions?.toLocaleString()} action{totalActions === 1 ? "" : "s"} taken
              across all campaigns for this bill.
            </p>
          )}
        </section>
      )}

      {/* Email your officials about this bill — direct action outside a
          campaign. Pick a target group (all Representatives / all Senators /
          the executive trio for a state bill; your U.S. delegation for a
          federal bill) → AI-drafted, personalized letter → send via
          Gmail/Outlook/mail app. Recipients are always populated (fixes the
          empty-"To" the old alert-response panel produced on bill pages). */}
      {officialGroups && (officialGroups.groups.length > 0 || officialGroups.needsProfile) && (
        <section id="email-officials" className="mb-6 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/25 to-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            ✉ Email your officials about this bill
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Draft a personalized letter and send it to the officials who decide this bill — your voice, your email address. Pick a group:
          </p>
          <div className="mt-3">
            <EmailGroupButton
              groups={officialGroups.groups}
              billId={bill.id}
              stance={billStance}
              needsProfile={officialGroups.needsProfile}
              scope={officialGroups.scope}
            />
          </div>
        </section>
      )}

      {/* Alerts for this bill. (The old empty-recipient DraftResponsePanel was
          removed from bill pages — the "Email your officials" section above is
          the working, recipient-populated send. DraftResponsePanel still lives
          on /alerts/[id] for genuine regulatory public-comment.) */}
      {(billAlerts.length > 0 || bill.active === true) && (
        <section id="draft-response" className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            📡 Alerts &amp; your response
          </h2>
          {billAlerts.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {billAlerts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/alerts/${a.id}`}
                    className="flex flex-wrap items-baseline gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs hover:border-emerald-600/60"
                  >
                    <span>
                      {a.severity === "critical" ? "🚨" : a.severity === "alert" ? "⚠️" : "👁"}
                    </span>
                    <span className="font-medium text-zinc-100">{a.title.slice(0, 110)}</span>
                    <span className="ml-auto text-[10px] text-zinc-500">
                      {new Date(a.occurs_at ?? a.created_at).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {billAlerts[0] ? (
            <p className="mt-3 text-xs text-zinc-400">
              Open an alert above to draft a public-comment response — or use{" "}
              <a href="#email-officials" className="text-emerald-400 hover:underline">✉ Email your officials</a>{" "}
              above to write the officials deciding this bill directly.
            </p>
          ) : (
            <p className="mt-3 text-xs text-zinc-400">
              No alerts yet for this bill. Spotted movement we missed?{" "}
              <Link href="/alerts/submit" className="text-emerald-400 hover:underline">
                Submit intel →
              </Link>
            </p>
          )}
        </section>
      )}

      {/* Inactive linked campaigns (legacy, for transparency) */}
      {campaigns.some((c) => !c.active) && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <details>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
              Past campaigns for this bill (inactive) ▾
            </summary>
            <ul className="mt-2 space-y-1">
              {campaigns
                .filter((c) => !c.active)
                .map((c) => (
                  <li key={c.id} className="text-xs text-zinc-500">
                    <span className="font-mono">{c.slug}</span>
                    <span className="ml-2 text-zinc-600">
                      created {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </section>
      )}

      {/* OpenStates abstracts (additional summaries) */}
      {detail && detail.abstracts.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <details open>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
              Official abstracts
            </summary>
            {detail.abstracts.map((a, i) => (
              <div key={i} className="mt-3">
                {a.note && (
                  <p className="text-xs font-semibold text-zinc-400">{a.note}</p>
                )}
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                  {a.abstract}
                </p>
              </div>
            ))}
          </details>
        </section>
      )}

      {/* DB raw summary (fallback if no live detail abstracts) */}
      {!detail?.abstracts?.length && bill.summary && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <details open>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
              Official abstract
            </summary>
            <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">{bill.summary}</p>
          </details>
        </section>
      )}

      {/* Official versions + sources (slim — patterns/momentum stay below) */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <details open>
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
            Official bill versions &amp; sources
          </summary>
          <div className="mt-3 space-y-2">
            {detail?.versions && detail.versions.length > 0 ? (
              detail.versions.map((v, i) => (
                <div key={i}>
                  <p className="text-xs text-zinc-500">
                    {v.note} · {v.date}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {v.links.map((l, j) => (
                      <li key={j}>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-emerald-400 hover:underline"
                        >
                          {l.media_type.includes("pdf") ? "📄 " : "🔗 "}
                          Open {l.media_type.split("/").pop() ?? "document"} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-400">
                We don&apos;t have direct version links cached. Use the source link
                below to navigate to the official bill text.
              </p>
            )}
          </div>
        </details>
      </section>

      {/* Full bill text — every captured version, switchable via tabs.
          Lets readers compare introduced vs amended versions on-site
          instead of bouncing to the state portal. */}
      {bill.bill_text_versions && bill.bill_text_versions.length > 0 && (
        <BillFullText versions={bill.bill_text_versions} />
      )}

      {/* Phase 3 D6: cross-state bill similarity. Surfaces semantic
          matches of this bill in OTHER states — when this is a KCPA
          variant or a 7-OH ban, the top match is usually the bill it
          was templated from. Cosine similarity ≥ 0.7 filter, top 5. */}
      {similarBills.length > 0 && (
        <section className="mb-6 rounded-lg border border-violet-500/30 bg-violet-950/10 p-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-violet-300">
            🔗 Similar bills in other states
            <span className="text-[10px] font-normal text-zinc-500">
              (top {similarBills.length} text-similarity matches above 60%)
            </span>
          </h2>
          <p className="text-[11px] text-zinc-400">
            Bills sharing language or scope with this one. High match scores often indicate a coalition shopping the same template across states.
          </p>
          <ul className="mt-3 space-y-2">
            {similarBills.map((s) => (
              <li key={s.bill.id}>
                <a
                  href={`/bills/${s.bill.id}`}
                  className="block rounded-md border border-violet-700/20 bg-zinc-950/40 p-2.5 transition hover:border-violet-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-mono font-semibold text-zinc-200">
                      {s.bill.state} · {s.bill.bill_number}
                    </span>
                    {s.bill.kratom_relevance === "anti" && (
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">Anti</span>
                    )}
                    {s.bill.kratom_relevance === "pro" && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">Pro</span>
                    )}
                    <span className="ml-auto font-mono text-violet-300">
                      {(s.similarity * 100).toFixed(0)}% match
                    </span>
                  </div>
                  {s.bill.title && (
                    <p className="mt-1 text-xs leading-snug text-zinc-100">
                      {s.bill.title.slice(0, 140)}{s.bill.title.length > 140 ? "…" : ""}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-zinc-600">
                    status: {s.bill.status ?? "?"}
                    {s.bill.last_action_at && (
                      <span> · last action {new Date(s.bill.last_action_at).toLocaleDateString()}</span>
                    )}
                  </p>
                </a>
              </li>
            ))}
          </ul>

          {/* Merged sub-list (was its own duplicate section): same-stance
              bills active in the last 12 months, minus ones already shown
              above as text-similarity matches. */}
          {similar.filter((s) => !similarBills.some((m) => m.bill.id === s.id)).length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
                Also moving now · same stance, last 12 months ({similar.filter((s) => !similarBills.some((m) => m.bill.id === s.id)).length}) ▾
              </summary>
              <ul className="mt-3 space-y-2">
                {similar.filter((s) => !similarBills.some((m) => m.bill.id === s.id)).map((s) => (
                  <li key={s.id} className="rounded-md border border-zinc-900 bg-zinc-950 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                        {s.state} · {s.bill_number}
                      </span>
                      {s.scope && s.scope !== "state" && (
                        <span className="rounded bg-purple-950/40 px-1.5 py-0.5 capitalize text-purple-300">
                          {s.scope}
                        </span>
                      )}
                      {s.status && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                          {billStatusLabel(s.status)}
                        </span>
                      )}
                      {s.last_action_at && (
                        <span className="ml-auto text-zinc-500">
                          {new Date(s.last_action_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <a href={`/bills/${s.id}`} className="mt-1 block text-zinc-200 hover:text-emerald-400">
                      {s.title ?? "(untitled)"}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* News coverage — every news article we've scraped that's been
          linked to this bill via the policy_alerts → bill_id chain.
          Deduplicated heavily so syndicated News12 / Newsday copies
          collapse into a single entry. Tells the bill's story
          chronologically. */}
      {newsCoverage.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              📰 News coverage · {newsCoverage.length}
            </h2>
            <span className="text-[10px] text-zinc-500">deduped across syndications</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Every news article we&apos;ve indexed that mentions this bill or its underlying event, oldest at the bottom.
          </p>
          <ul className="mt-3 space-y-2">
            {newsCoverage.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/news/${n.id}`}
                  className="block rounded-md border border-zinc-800 bg-zinc-950/60 p-3 hover:border-emerald-500"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    {n.source_name && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                        {n.source_name}
                      </span>
                    )}
                    {n.published_at && (
                      <span className="text-zinc-500">
                        {new Date(n.published_at).toLocaleDateString()}
                      </span>
                    )}
                    <span className="ml-auto text-emerald-400">read →</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-zinc-100 line-clamp-2">
                    {n.title}
                  </p>
                  {n.summary && (
                    <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2">
                      {n.summary.slice(0, 200)}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Community discussion — every active anti/pro state/federal bill
          gets an auto-posted forum thread (see scripts/auto-post-bills-to-forum.mjs).
          Surfacing the link here makes the comments discoverable from
          /bills/<id>. Falls back to "start the discussion" when no thread
          exists yet. */}
      {forumThread ? (
        <section className="mb-6 rounded-lg border border-sky-700/40 bg-sky-950/15 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-300">
              💬 Community discussion
            </h2>
            <span className="text-[10px] text-zinc-500">
              {forumThread.post_count === 0 ? "no replies yet — be first" : `${forumThread.post_count} repl${forumThread.post_count === 1 ? "y" : "ies"}`}
              {forumThread.last_activity_at && forumThread.post_count > 0 && (
                <span> · last {new Date(forumThread.last_activity_at).toLocaleDateString()}</span>
              )}
            </span>
          </div>
          <a
            href={`/forum/${(forumThread.state ?? "federal").toLowerCase()}/${forumThread.id}`}
            className="mt-2 block rounded-md border border-sky-800/30 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 hover:border-sky-500"
          >
            {forumThread.title.length > 110 ? forumThread.title.slice(0, 110) + "…" : forumThread.title}
            <span className="ml-2 text-xs text-sky-300">Join thread →</span>
          </a>
          <p className="mt-2 text-[11px] text-zinc-500">
            Native comments on the {(forumThread.state ?? "federal").toUpperCase()} forum. Reply with on-the-ground updates, hearing audio, or coordination — visible to every iKratom member.
          </p>
        </section>
      ) : (bill.kratom_relevance === "anti" || bill.kratom_relevance === "pro") && bill.scope === "state" && bill.state && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            💬 Community discussion
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            No forum thread for this bill yet. The auto-poster picks up active anti/pro state bills hourly. Want to start the discussion now?
          </p>
          <a
            href={`/forum/${bill.state.toLowerCase()}/new`}
            className="mt-2 inline-block rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            Start a thread on /forum/{bill.state} →
          </a>
        </section>
      )}

      {/* Patterns + momentum (versions/sources moved above full text) */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Patterns &amp; momentum
        </h2>

        {/* Coordinated-operation cluster memberships — shows that
            this bill is part of nationwide patterns, with click-through
            to /intel/operations for the full network view. */}
        {billClusterMemberships.length > 0 && (
          <div className="mt-4 rounded-md border border-violet-700/40 bg-violet-950/15 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">
              🕸 Coordinated operation · this bill is part of nationwide pattern{billClusterMemberships.length === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-[10px] text-zinc-500">
              The same operative language appears across multiple states. Click any pattern below for the full network.
            </p>
            <ul className="mt-2 space-y-1.5">
              {billClusterMemberships.map((c) => {
                const postureTone =
                  c.posture === "restrictive" ? "border-red-700/40 bg-red-950/10 text-red-200" :
                  c.posture === "protective" ? "border-emerald-700/40 bg-emerald-950/10 text-emerald-200" :
                  c.posture === "regulatory" ? "border-amber-700/40 bg-amber-950/10 text-amber-200" :
                  "border-zinc-700 bg-zinc-950/40 text-zinc-300";
                const postureEmoji =
                  c.posture === "restrictive" ? "🚫" :
                  c.posture === "protective" ? "🛡" :
                  c.posture === "regulatory" ? "⚖" : "↔";
                return (
                  <li key={c.cluster_id}>
                    <Link
                      href={`/intel/operations#${c.slug}`}
                      className={`block rounded border px-2.5 py-1.5 text-[11px] transition hover:opacity-90 ${postureTone}`}
                      title={c.match_reason ?? undefined}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">
                          {postureEmoji} {c.name}
                        </span>
                        <span className="ml-auto text-[10px] opacity-80">
                          <strong className="font-mono tabular-nums">{c.bill_count}</strong> bills ·{" "}
                          <strong className="font-mono tabular-nums">{c.state_count}</strong> states
                        </span>
                      </div>
                      {c.match_reason && (
                        <p className="mt-1 text-[10px] italic opacity-70 line-clamp-2">
                          {c.match_reason.slice(0, 200)}{c.match_reason.length > 200 ? "…" : ""}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Momentum prediction — at-a-glance read on whether the bill
            is advancing, stalled, or effectively dead. Heuristic only;
            no ML. Surfaces the contributing signals so an advocate can
            understand WHY the prediction lands where it does. */}
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={`rounded border px-2 py-1 text-[11px] font-semibold ${MOMENTUM_TONE[momentum.label]}`}>
              {MOMENTUM_LABEL[momentum.label]}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              momentum score
            </span>
            <span className="font-mono text-xs text-zinc-300">
              {momentum.score}/100
            </span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">{momentum.rationale}</p>
          {momentum.signals.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1 text-[10px] text-zinc-500">
              {momentum.signals.map((s, i) => (
                <li key={i} className="rounded bg-zinc-900/60 px-1.5 py-0.5">{s}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[9px] text-zinc-600">
            Heuristic v1 — combines recency, status, sponsor count, cluster membership, news coverage. Not a prediction with statistical guarantees; treat as a fast read, not a verdict.
          </p>
        </div>

        {/* Scientific basis — cross-referenced research from our library.
            Auto-aligned via cluster→topic mapping + keyword overlap.
            Tagged: aligned (paper supports the bill's premise) /
            contradictory (paper refutes) / context (relevant background). */}
        {researchAlignments.length > 0 && (
          <div className="mt-4 rounded-md border border-sky-700/40 bg-sky-950/15 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              🔬 Scientific basis · {researchAlignments.length} research paper{researchAlignments.length === 1 ? "" : "s"} cross-referenced
            </p>
            <p className="mt-1 text-[10px] text-zinc-500">
              Papers from our peer-reviewed library that bear on this bill&apos;s premise. Auto-matched via cluster topic + keyword overlap; admin can override.
            </p>
            {(() => {
              const aligned = researchAlignments.filter((r) => r.alignment === "aligned").length;
              const contradictory = researchAlignments.filter((r) => r.alignment === "contradictory").length;
              const context = researchAlignments.filter((r) => r.alignment === "context").length;
              return (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                  {aligned > 0 && <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">✓ {aligned} aligned</span>}
                  {contradictory > 0 && <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">✗ {contradictory} contradictory</span>}
                  {context > 0 && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">○ {context} context</span>}
                </div>
              );
            })()}
            <ul className="mt-2 space-y-1.5">
              {researchAlignments.map((r) => {
                const alignTone =
                  r.alignment === "aligned" ? "border-emerald-700/30 bg-emerald-950/5"
                  : r.alignment === "contradictory" ? "border-red-700/30 bg-red-950/5"
                  : "border-zinc-800 bg-zinc-900/40";
                const alignEmoji =
                  r.alignment === "aligned" ? "✓"
                  : r.alignment === "contradictory" ? "✗"
                  : "○";
                const sourceUrl = r.pubmed_id
                  ? `https://pubmed.ncbi.nlm.nih.gov/${r.pubmed_id}/`
                  : r.doi ? `https://doi.org/${r.doi}` : null;
                return (
                  <li key={r.paper_id} className={`rounded border px-2.5 py-1.5 text-[11px] ${alignTone}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-zinc-500">{alignEmoji}</span>
                      <span className="font-semibold text-zinc-100">
                        {sourceUrl ? (
                          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {r.title}
                          </a>
                        ) : r.title}
                      </span>
                      {r.publication_year && (
                        <span className="font-mono text-[10px] text-zinc-500">({r.publication_year})</span>
                      )}
                      {r.ai_evidence_strength && (
                        <span className="rounded bg-zinc-900/60 px-1 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                          {r.ai_evidence_strength}
                        </span>
                      )}
                    </div>
                    {r.journal && (
                      <p className="text-[10px] italic text-zinc-500">{r.journal}</p>
                    )}
                    {r.ai_key_findings_md && (
                      <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">
                        {r.ai_key_findings_md.slice(0, 200)}{r.ai_key_findings_md.length > 200 ? "…" : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Sponsors — who introduced / signed onto this bill, with portraits
            linking to each official's dossier (record, stance, how to contact). */}
        {sponsors.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Sponsors ({sponsors.length})
              </p>
              <a href={`/legislators?state=${bill.state}`} className="text-xs text-emerald-400 hover:underline">
                All {bill.state} officials →
              </a>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sponsors.map((s, i) => {
                const isPrimary = s.classification === "primary";
                const name = s.legislator?.full_name ?? s.name;
                const party = s.party ?? s.legislator?.party ?? null;
                const card = (
                  <span className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    isPrimary ? "border-amber-700/50 bg-amber-950/20" : "border-zinc-800 bg-zinc-950/40"
                  }`}>
                    <OfficialAvatar name={name} portraitUrl={s.legislator?.portrait_url} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-sm font-medium text-zinc-100">
                        {isPrimary && <span title="Primary sponsor" className="text-amber-300">★</span>}
                        <span className="truncate">{name}</span>
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {isPrimary ? "Primary sponsor" : "Cosponsor"}
                        {party ? ` · ${party}` : ""}
                        {s.district ? ` · D${s.district}` : ""}
                      </span>
                    </span>
                    {s.legislator_id && <span className="text-zinc-600" aria-hidden="true">›</span>}
                  </span>
                );
                return (
                  <li key={`${s.name}-${i}`}>
                    {s.legislator_id ? (
                      <a href={`/legislators/${s.legislator_id}/briefing`} className="block rounded-lg transition hover:opacity-90">{card}</a>
                    ) : card}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[11px] text-zinc-600">Tap a sponsor for their record, stance &amp; how to contact them.</p>
          </div>
        )}

        {/* Aggregated sponsor donor industries (federal-only, derived
            from legislator_donors.top_industries by classify-donor-
            industries.mjs). Surfaces the substance-policy-adjacent
            industries that collectively bankrolled this bill's
            sponsors. State-level bills typically render empty since
            state legislators don't have OpenFEC donor data. */}
        {sponsorIndustryAgg.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-700/30 bg-amber-950/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              💰 Sponsors&apos; collective donor industries
              <span className="ml-2 text-[10px] font-normal text-zinc-500">
                ({sponsorsWithDonorData} of {sponsors.length} sponsor{sponsors.length === 1 ? "" : "s"} have federal donor data)
              </span>
            </p>
            <p className="mt-1 text-[10px] text-zinc-500">
              Industries that collectively contributed to this bill&apos;s sponsors. Sum of FEC schedule-A by-employer
              contributions, classified by industry pattern. Substance-policy-adjacent industries (⚠) warrant advocate scrutiny.
            </p>
            <ul className="mt-2 space-y-1">
              {sponsorIndustryAgg.map((ind) => (
                <li
                  key={ind.industry}
                  className={`flex flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-[11px] ${
                    ind.advocate_flag
                      ? "border border-red-700/40 bg-red-950/15 text-red-100"
                      : "text-zinc-400"
                  }`}
                >
                  {ind.advocate_flag && (
                    <span className="text-[10px] font-bold text-red-300">⚠</span>
                  )}
                  <span className={ind.advocate_flag ? "font-semibold" : ""}>
                    {ind.label}
                  </span>
                  <span className="text-[9px] text-zinc-500">
                    ({ind.legislator_count} sponsor{ind.legislator_count === 1 ? "" : "s"})
                  </span>
                  <span className="ml-auto font-mono tabular-nums text-zinc-200">
                    ${ind.amount.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Committee leverage — every member of the committee where
            this bill currently sits, ranked by threat-matrix tier so
            advocates know who can block / advance / be flipped.
            Highest-leverage call list on the page. */}
        {committeeMembers.length > 0 && (
          <div className="mt-4 rounded-md border border-emerald-700/40 bg-emerald-950/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              🎯 Committee leverage · who&apos;s deciding this bill
            </p>
            <p className="mt-1 text-[10px] text-zinc-500">
              The bill is in <span className="font-mono text-zinc-300">{currentCommitteeName ?? "committee"}</span>.
              {" "}{committeeMembers.length} member{committeeMembers.length === 1 ? "" : "s"}, ranked by threat-matrix tier.
              <span className="ml-1 text-emerald-300">
                {(() => {
                  const callable = committeeMembers.filter(
                    (m) => m.tier === "flippable_target" || m.tier === "hostile_decision_maker" || m.committee_role === "chair",
                  );
                  return callable.length > 0
                    ? `${callable.length} priority call target${callable.length === 1 ? "" : "s"} below.`
                    : "";
                })()}
              </span>
            </p>
            <ul className="mt-2 space-y-1.5">
              {committeeMembers.map((m) => {
                const isPriority =
                  m.tier === "flippable_target" ||
                  m.tier === "hostile_decision_maker" ||
                  m.committee_role === "chair";
                return (
                <li key={m.legislator_id}>
                  <div
                    className={`block rounded border px-2.5 py-1.5 text-[11px] ${m.tier_color}`}
                    title={m.rationale}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <a
                        href={`/legislators/${m.legislator_id}/briefing`}
                        className="font-semibold hover:underline"
                      >
                        {m.full_name}
                      </a>
                      <span className="rounded bg-zinc-900/40 px-1.5 py-0.5 font-mono text-[9px] uppercase">
                        {m.role.replace(/_/g, " ")}
                      </span>
                      {m.district && (
                        <span className="text-[10px] text-zinc-400">D{m.district}</span>
                      )}
                      {m.party && (
                        <span className="text-[10px] text-zinc-400">{m.party}</span>
                      )}
                      {m.committee_role === "chair" && (
                        <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                          🪑 CHAIR
                        </span>
                      )}
                      {m.committee_role === "vice_chair" && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">
                          vice chair
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-[10px]">
                          {m.tier_emoji} {m.tier_label}
                        </span>
                        <span className="font-mono text-[9px] opacity-75">
                          T{m.threat_score}·V{m.vulnerability_score}
                        </span>
                      </span>
                    </div>
                    {/* Contact row — only when we have a phone/email AND
                        this member is one of the priority targets. Keeps
                        the panel scannable; the briefing covers full
                        contact details for any row the user clicks through. */}
                    {isPriority && (m.phone || m.email) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-zinc-900/40 pt-1 text-[10px]">
                        {m.phone && (
                          <a
                            href={`tel:${m.phone.replace(/[^\d+]/g, "")}`}
                            className="rounded bg-emerald-950/40 px-2 py-0.5 font-mono text-emerald-200 hover:bg-emerald-900/40"
                          >
                            📞 {m.phone}
                          </a>
                        )}
                        <EmailOfficialButton
                          official={{
                            id: m.legislator_id,
                            name: m.full_name,
                            role: m.role,
                            title: m.title,
                            state: m.state,
                            email: m.email,
                            website: m.website,
                          }}
                          context={{ kind: "bill", billId: bill.id }}
                          source="bill_committee"
                          variant="inline"
                          label={m.email ? "✉ email" : "🌐 contact"}
                        />
                        <span className="text-zinc-500">— {m.tier === "flippable_target" ? "highest conversion ROI" : m.committee_role === "chair" ? "controls the calendar" : "blocking leverage"}</span>
                      </div>
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Sources */}
        <div className="mt-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Official sources
          </p>
          {/* Direct state-legislature link is the most credible — show first */}
          {bill.official_url && (
            <p>
              <a
                href={bill.official_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-400 hover:underline"
              >
                ⭐ Official state legislature page ↗
              </a>
            </p>
          )}
          {detail?.sources && detail.sources.length > 0 ? (
            <ul className="space-y-1">
              {detail.sources
                .filter((s) => s.url !== bill.official_url) // dedupe
                .map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-400 hover:underline"
                    >
                      {s.note || s.url}
                    </a>
                  </li>
                ))}
            </ul>
          ) : null}
          {bill.source_url && (
            <p>
              <a
                href={bill.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-400 hover:underline"
              >
                View on OpenStates ↗
              </a>
            </p>
          )}
        </div>
      </section>

      {/* Sponsors */}
      {detail?.sponsorships && detail.sponsorships.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Sponsors
          </h2>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {detail.sponsorships.map((s, i) => (
              <li key={i} className="text-sm text-zinc-300">
                {s.primary && <span className="text-emerald-400">★ </span>}
                {s.name}
                {s.party && <span className="ml-2 text-zinc-500">({s.party})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* People of interest (bill_stakeholders) — NEUTRAL TRACKER (mig 0243).
          Each figure's documented position on the natural leaf and on 7-OH,
          with evidence. No ally/opponent verdict; grouped by neutral role. */}
      {stakeholders.length > 0 && (() => {
        const grouped = new Map<string, StakeholderRow[]>();
        for (const s of stakeholders) {
          const dr = displayRole(s.role_type);
          if (!grouped.has(dr)) grouped.set(dr, []);
          grouped.get(dr)!.push(s);
        }
        const order = orderedDisplayRoles(stakeholders.map(s => s.role_type));
        return (
          <section className="mb-6 rounded-lg border border-violet-700/30 bg-zinc-950/40 p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300">
                People of interest ({stakeholders.length})
              </h2>
              <IntelTipForm
                billId={bill.id}
                billTitle={bill.title ?? bill.bill_number}
                billState={bill.state}
                billLocality={bill.locality}
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Named figures tied to this bill, with each one&apos;s <strong className="text-zinc-300">documented position</strong> on the natural leaf and on 7-OH (two separate axes, with sources). We state where people stand as fact — not as &quot;ally&quot; or &quot;opponent.&quot; Submit intel with the button above to grow this list.
            </p>
            <div className="mt-4 space-y-3">
              {order.flatMap(role => {
                const rows = grouped.get(role) ?? [];
                if (rows.length === 0) return [];
                const meta = roleMeta(role);
                return [(
                  <div key={role} className={`rounded-md border p-3 ${meta.cls}`}>
                    <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${meta.valueCls}`}>
                      {meta.emoji} {meta.label} ({rows.length})
                    </p>
                    <ul className="space-y-2">
                      {rows.map(s => (
                        <li key={s.id} className="text-[12px]">
                          <p className="font-semibold text-zinc-100">{s.name}</p>
                          {(s.title || s.organization) && (
                            <p className="text-[11px] text-zinc-400">
                              {s.title}{s.title && s.organization ? " · " : ""}{s.organization}
                            </p>
                          )}
                          <StanceChips
                            leafStance={s.leaf_stance as StanceValue}
                            sevenOhStance={s.seven_oh_stance as StanceValue}
                            leafUrl={s.leaf_evidence_url}
                            sevenOhUrl={s.seven_oh_evidence_url}
                            summary={s.stance_summary}
                          />
                          <p className="mt-1 text-[11px] leading-snug text-zinc-300">{s.reasoning}</p>
                          {(s.email || s.phone || s.website || s.twitter_handle || s.linkedin_url) && (
                            <p className="mt-1 flex flex-wrap gap-2 text-[10px]">
                              <EmailOfficialButton
                                official={{ id: null, name: s.name, title: s.title, email: s.email, website: s.website }}
                                context={{ kind: "stakeholder", billId: bill.id }}
                                source="bill_stakeholder"
                                variant="inline"
                              />
                              {s.phone && <a href={`tel:${s.phone}`} className="text-emerald-400 hover:underline">{s.phone}</a>}
                              {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">website</a>}
                              {s.twitter_handle && <a href={`https://twitter.com/${s.twitter_handle.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">@{s.twitter_handle.replace(/^@/, "")}</a>}
                              {s.linkedin_url && <a href={s.linkedin_url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">LinkedIn</a>}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )];
              })}
            </div>
          </section>
        );
      })()}

      {/* Action history */}
      {detail?.actions && detail.actions.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Action history
          </h2>
          <ol className="mt-3 space-y-2">
            {detail.actions.slice(0, 30).map((a, i) => (
              <li key={i} className="text-xs text-zinc-300">
                <span className="font-mono text-zinc-500">{a.date}</span>
                {" — "}
                <span>{a.description}</span>
                {a.organization?.name && (
                  <span className="ml-1 text-zinc-600">({a.organization.name})</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Sync metadata footer */}
      <p className="mt-8 text-center text-xs text-zinc-600">
        Bill data last synced{" "}
        {bill.last_synced_at ? new Date(bill.last_synced_at).toLocaleString() : "unknown"}.
        {detail
          ? " Live OpenStates lookup successful (cached 1 hour)."
          : " Live OpenStates lookup unavailable — showing cached fields only."}
      </p>
    </div>
  );
}

/**
 * Renders translated text for an entity if a translation is cached for the
 * current locale; falls back to the original. Server component (async).
 */
async function TranslatedSection({
  type, id, sourceText, className,
}: {
  type: "bill_summary" | "bill_callout";
  id: string;
  sourceText: string;
  className?: string;
}) {
  const locale = await readLocale();
  if (locale === "en") {
    return <p className={className ?? "mt-2 text-base text-zinc-200"}>{sourceText}</p>;
  }
  const supabase = await createClient();
  const translated = await getTranslation(supabase, { type, id }, locale);
  if (!translated) {
    return (
      <div>
        <p className={className ?? "mt-2 text-base text-zinc-200"}>{sourceText}</p>
        <p className="mt-1 text-[10px] text-zinc-600">
          (No translation available yet — admin: run <code className="rounded bg-zinc-950 px-1">npm run translate:content</code>.)
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className={className ?? "mt-2 text-base text-zinc-200"}>{translated}</p>
      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer">Show original (English)</summary>
        <p className="mt-1">{sourceText}</p>
      </details>
    </div>
  );
}
