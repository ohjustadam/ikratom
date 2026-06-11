import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { dedupNews, type NewsItem } from "@/lib/news-dedup";
import { StatusHeader, type StateStatusData } from "./StatusHeader";
import { StateOfficials } from "./StateOfficials";
import { resolveBillHrefs } from "@/modules/state-status/evidence";
import { STATE_NAMES } from "@/lib/state-names";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  const codeUpper = code.toUpperCase();
  const stateName = STATE_NAMES[codeUpper];
  if (!stateName) return { title: "State · iKratom" };
  return {
    title: `${stateName} kratom policy — bills, meetings, calls · iKratom`,
    description: `Every kratom-policy event in ${stateName}: bills, hearings, municipal meetings, recent alerts. Take action with one-click calls + emails.`,
    openGraph: {
      title: `${stateName} kratom advocacy hub`,
      description: `Every kratom-policy event in ${stateName} — bills, hearings, municipal meetings, news.`,
      url: `${SITE}/states/${codeUpper}`,
      siteName: "iKratom",
    },
  };
}

/**
 * /states/[code] — single-state aggregated landing page.
 *
 * Pulls everything relevant to a single state in one place:
 *   - Active bills (anti / pro)
 *   - Upcoming approved municipal_meetings (next 90d)
 *   - Recent approved policy_alerts (last 30d)
 *   - Active campaigns
 *   - Link to state briefing
 *   - Calendar / pulse cross-links scoped to this state
 *
 * Designed to be shareable: someone organizing in TX can send
 * https://www.ikratom.org/states/TX to allies and it's a full picture
 * of TX policy state.
 */
export default async function StatePage({ params }: Props) {
  const { code } = await params;
  const codeUpper = code.toUpperCase();
  const stateName = STATE_NAMES[codeUpper];
  if (!stateName) notFound();

  const supabase = await createClient();

  // Canonical status (Mission Control). Resilient: maybeSingle() → null when
  // no row, and a missing table (migration 0173 not applied) sets `error`
  // (not a throw) so this stays null and the header simply doesn't render.
  let stateStatus: StateStatusData | null = null;
  {
    const { data } = await supabase
      .from("state_status")
      .select(
        "derived_leaf_status, derived_7oh_status, basis, admin_leaf_status, admin_7oh_status, admin_note, confirmed_at, leaf_evidence_bill, sevenoh_evidence_bill",
      )
      .eq("state", codeUpper)
      .maybeSingle();
    stateStatus = (data as StateStatusData | null) ?? null;
  }
  const statusBillHrefs = stateStatus
    ? await resolveBillHrefs(codeUpper, [stateStatus.leaf_evidence_bill, stateStatus.sevenoh_evidence_bill])
    : {};

  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const horizon = new Date(now.getTime() + 90 * 86_400_000).toISOString();

  // 2026-06-11: the old 12-month "truly active" wall-clock window is gone —
  // the bills.active flag (LegiScan session hygiene) is now the truth signal
  // the 2026-05-14 owner directive wanted. Carryover bills stay visible.
  // Past-meeting window: meetings in the last 14 days are still narratively
  // 'live' — the Suffolk County vote happened 2 days ago and is the central
  // active fight in NY right now; showing it on /states/NY is essential.
  const pastMeetingWindow = new Date(now.getTime() - 14 * 86_400_000).toISOString();

  // News window: last 60 days of kratom coverage tagged to this state.
  // Wider window than the 30d alert window because news context can be
  // a few months stale and still valuable for organizing.
  const newsSince = new Date(now.getTime() - 60 * 86_400_000).toISOString();

  // Threat-tier stats — surface "your state has X active opponents,
  // Y flippable targets" so users landing here see exactly how much
  // work is to be done. Uses the same composite scorer as
  // /intel/threat-matrix; data pulled in the parallel block below.
  const [bills, meetings, pastMeetings, alerts, campaigns, briefing, newsRaw, takebackBill, stateLegs, stateStances, stateSponsors, stateKratomCommittees] = await Promise.all([
    supabase
      .from("bills")
      .select("id, bill_number, title, status, kratom_relevance, last_action, last_action_at, scope, locality")
      // The truthful `active` flag (LegiScan session hygiene) IS the
      // currency signal — a wall-clock window here hid whole states whose
      // carryover bills sat without recent action while fully alive
      // (post-heal OK rendered zero bills). Moving-vs-quiet bucketing
      // below still uses last_action_at for emphasis.
      .eq("state", codeUpper)
      .eq("active", true)
      .in("kratom_relevance", ["anti", "pro"])
      .neq("status", "dead")
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(40),
    supabase
      .from("municipal_meetings")
      .select("id, locality, body_name, meeting_at, zoom_url, agenda_url")
      .eq("state", codeUpper)
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon)
      .order("meeting_at", { ascending: true })
      .limit(15),
    // Past meetings within last 14 days — important for things like the
    // Suffolk County vote that happened 2 days ago and is the live fight.
    supabase
      .from("municipal_meetings")
      .select("id, locality, body_name, meeting_at, kratom_relevance, agenda_url")
      .eq("state", codeUpper)
      .eq("moderation_status", "approved")
      .eq("kratom_relevance", "confirmed")
      .gte("meeting_at", pastMeetingWindow)
      .lt("meeting_at", now.toISOString())
      .order("meeting_at", { ascending: false })
      .limit(5),
    supabase
      .from("policy_alerts")
      .select("id, kind, severity, title, body, locality, created_at, occurs_at, bill_id, source_url")
      .or(`locality.eq.${codeUpper},locality.ilike.%, ${codeUpper}`)
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .gte("created_at", since30d)
      .order("created_at", { ascending: false })
      .limit(30),  // larger pull — many drop after real-event-date filter
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb")
      .eq("state", codeUpper)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("state_briefings")
      .select("state, published_at")
      .eq("state", codeUpper)
      .maybeSingle(),
    supabase
      .from("news_items")
      .select("id, title, source_name, url, published_at, summary")
      .eq("state", codeUpper)
      .eq("active", true)
      .not("body_has_kratom_keyword", "is", false)
      .gte("published_at", newsSince)
      .order("published_at", { ascending: false })
      .limit(40),
    // Takeback-status check: does this state have curated banned-state
    // intel? If opposition_summary_md is populated for an active enacted
    // (or imminent) state-scope bill, surface the link to its takeback
    // plan from the page header.
    supabase
      .from("bills")
      .select("id, status, bill_number")
      .eq("state", codeUpper)
      .eq("active", true)
      .eq("scope", "state")
      .eq("kratom_relevance", "anti")
      .in("status", ["enacted", "passed_chamber"])
      .not("opposition_summary_md", "is", null)
      .order("status", { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Threat-stat inputs: legislators + stances + anti/pro sponsorships
    // + kratom-relevant committee memberships, all scoped to this state.
    supabase
      .from("legislators")
      .select("id, role")
      .eq("state", codeUpper)
      .eq("active", true)
      .limit(2000),
    supabase.from("legislator_kratom_stance").select("legislator_id, stance"),
    supabase
      .from("bill_sponsors")
      .select("legislator_id, classification, bills!inner(state, kratom_relevance, active)")
      .eq("bills.state", codeUpper)
      .eq("bills.active", true)
      .in("bills.kratom_relevance", ["anti", "pro"]),
    supabase
      .from("legislator_committees")
      .select("legislator_id, role")
      .eq("is_kratom_relevant", true)
      .limit(2000),
  ]);

  // ── Threat-tier counts using the composite scorer
  let threatStats = { active_opponent: 0, hostile_decision_maker: 0, flippable_target: 0, champion: 0, sympathetic_ally: 0, education_target: 0, low_priority: 0 };
  try {
    const { assessThreat } = await import("@/lib/legislator-threat-score");
    const legs = ((stateLegs?.data ?? []) as Array<{ id: string; role: string }>);
    const legIds = new Set(legs.map((l) => l.id));
    const stanceByLeg = new Map<string, string>();
    for (const r of (stateStances?.data ?? []) as Array<{ legislator_id: string; stance: string }>) {
      if (legIds.has(r.legislator_id)) stanceByLeg.set(r.legislator_id, r.stance);
    }
    type SpAgg = { has_anti: boolean; has_pro: boolean; anti_primary: number; primary_count: number; cosponsor_count: number };
    const spByLeg = new Map<string, SpAgg>();
    for (const s of (stateSponsors?.data ?? []) as Array<{ legislator_id: string; classification: string; bills: { kratom_relevance: string | null } | Array<{ kratom_relevance: string | null }> | null }>) {
      const b = Array.isArray(s.bills) ? s.bills[0] : s.bills;
      if (!b) continue;
      const agg = spByLeg.get(s.legislator_id) ?? { has_anti: false, has_pro: false, anti_primary: 0, primary_count: 0, cosponsor_count: 0 };
      if (s.classification === "primary") {
        agg.primary_count++;
        if (b.kratom_relevance === "anti") agg.anti_primary++;
      } else agg.cosponsor_count++;
      if (b.kratom_relevance === "anti") agg.has_anti = true;
      if (b.kratom_relevance === "pro") agg.has_pro = true;
      spByLeg.set(s.legislator_id, agg);
    }
    const onKratomCmtLegs = new Set<string>();
    const chairKratomLegs = new Set<string>();
    for (const c of (stateKratomCommittees?.data ?? []) as Array<{ legislator_id: string; role: string }>) {
      if (!legIds.has(c.legislator_id)) continue;
      onKratomCmtLegs.add(c.legislator_id);
      if (c.role === "chair") chairKratomLegs.add(c.legislator_id);
    }
    for (const l of legs) {
      const stance = (stanceByLeg.get(l.id) ?? "unknown") as "champion" | "sympathetic" | "neutral" | "hostile" | "unknown";
      const sp = spByLeg.get(l.id);
      const a = assessThreat({
        stance,
        has_anti_sponsorship: !!sp?.has_anti,
        has_pro_sponsorship: !!sp?.has_pro,
        primary_sponsorship_count: sp?.anti_primary ?? 0,
        cosponsorship_count: sp?.cosponsor_count ?? 0,
        is_chair_of_kratom_relevant: chairKratomLegs.has(l.id),
        is_member_of_kratom_relevant: onKratomCmtLegs.has(l.id),
        bills_in_their_committees: 0,
        pharma_usd: null, alcohol_usd: null, tobacco_usd: null,
        addiction_treatment_usd: null, cannabis_usd: null, gaming_usd: null, hospital_health_usd: null,
        kratom_adjacent_trade_count: null,
      });
      threatStats[a.tier as keyof typeof threatStats] += 1;
    }
  } catch {
    // threat-score lib unavailable — silent.
  }
  const actionableThreatCount =
    threatStats.active_opponent +
    threatStats.hostile_decision_maker +
    threatStats.flippable_target +
    threatStats.champion +
    threatStats.sympathetic_ally;

  // Active coordinated operations in this state — surfaces which of
  // the 8 detected model-legislation patterns have bills here. Single
  // join through bill_cluster_members → bills(state).
  type StateClusterRow = { slug: string; name: string; posture: string; bill_count: number };
  let stateClusters: StateClusterRow[] = [];
  try {
    const { data: cm } = await supabase
      .from("bill_cluster_members")
      .select("bill_clusters!inner(slug, name, posture), bills!inner(state, active)")
      .eq("bills.state", codeUpper)
      .eq("bills.active", true);
    const counts = new Map<string, StateClusterRow>();
    type CMRow = {
      bill_clusters: { slug: string; name: string; posture: string }
                   | Array<{ slug: string; name: string; posture: string }> | null;
    };
    for (const m of (cm ?? []) as CMRow[]) {
      const c = Array.isArray(m.bill_clusters) ? m.bill_clusters[0] : m.bill_clusters;
      if (!c) continue;
      const cur = counts.get(c.slug) ?? { slug: c.slug, name: c.name, posture: c.posture, bill_count: 0 };
      cur.bill_count += 1;
      counts.set(c.slug, cur);
    }
    stateClusters = [...counts.values()].sort((a, b) => b.bill_count - a.bill_count);
  } catch { /* pre-0151 deploy */ }

  // Top operators in this state — legislators who primary-sponsor
  // cluster-membered bills here. Surfaces who's running the local
  // arm of the coordinated operations. Defensive try around the
  // multi-step join so a single-cluster table failure doesn't
  // tear down the state page.
  type StateOperator = {
    legislator_id: string;
    full_name: string;
    role: string;
    party: string | null;
    cluster_slugs: string[];
    bill_count: number;
  };
  let stateOperators: StateOperator[] = [];
  try {
    // Cap to 500 — well under Supabase's .in() limit, well above any
    // realistic per-state active kratom-bill count. Defensive against
    // future data growth and pathological backfill bugs.
    const { data: stateBillsForOps } = await supabase
      .from("bills")
      .select("id")
      .eq("state", codeUpper)
      .eq("active", true)
      .limit(500);
    const billIds = (stateBillsForOps ?? []).map((b) => b.id as string);
    if (billIds.length > 0) {
      const [sponsorsRes, membersRes] = await Promise.all([
        supabase
          .from("bill_sponsors")
          .select("legislator_id, bill_id, classification, legislators!inner(id, full_name, role, party, active)")
          .in("bill_id", billIds)
          .eq("classification", "primary")
          .eq("legislators.active", true),
        supabase
          .from("bill_cluster_members")
          .select("bill_id, bill_clusters!inner(slug)")
          .in("bill_id", billIds),
      ]);
      type BillCluster = { slug: string };
      const billToSlugs = new Map<string, Set<string>>();
      for (const m of (membersRes.data ?? []) as Array<{
        bill_id: string; bill_clusters: BillCluster | BillCluster[] | null;
      }>) {
        const c = Array.isArray(m.bill_clusters) ? m.bill_clusters[0] : m.bill_clusters;
        if (!c) continue;
        if (!billToSlugs.has(m.bill_id)) billToSlugs.set(m.bill_id, new Set());
        billToSlugs.get(m.bill_id)!.add(c.slug);
      }
      type LegInfo = { id: string; full_name: string; role: string; party: string | null };
      const byLeg = new Map<string, {
        leg: LegInfo; bills: Set<string>; clusters: Set<string>;
      }>();
      for (const s of (sponsorsRes.data ?? []) as Array<{
        legislator_id: string; bill_id: string;
        legislators: LegInfo | LegInfo[] | null;
      }>) {
        const leg = Array.isArray(s.legislators) ? s.legislators[0] : s.legislators;
        if (!leg) continue;
        const slugs = billToSlugs.get(s.bill_id);
        if (!slugs || slugs.size === 0) continue;
        const agg = byLeg.get(s.legislator_id) ?? {
          leg, bills: new Set<string>(), clusters: new Set<string>(),
        };
        agg.bills.add(s.bill_id);
        for (const slug of slugs) agg.clusters.add(slug);
        byLeg.set(s.legislator_id, agg);
      }
      stateOperators = [...byLeg.entries()]
        .map(([id, v]) => ({
          legislator_id: id,
          full_name: v.leg.full_name,
          role: v.leg.role,
          party: v.leg.party,
          cluster_slugs: [...v.clusters],
          bill_count: v.bills.size,
        }))
        .filter((o) => o.cluster_slugs.length >= 1)
        .sort((a, b) =>
          b.cluster_slugs.length - a.cluster_slugs.length ||
          b.bill_count - a.bill_count,
        );
    }
  } catch { /* pre-migration */ }

  // Real-event-date filter for alerts — match the freshness logic
  // from PRs #199 + #203 so this page doesn't surface 100-day-old
  // news as 'recent alerts' just because the alert row was
  // classified today.
  const rawAlerts = (alerts.data ?? []) as Array<{
    id: string; kind: string; severity: string; title: string; body: string | null;
    locality: string; created_at: string; occurs_at: string | null;
    bill_id: string | null; source_url: string | null;
  }>;
  const alertIds = rawAlerts.map((a) => a.id);
  const newsByAlertId = new Map<string, string>();
  if (alertIds.length > 0) {
    const { data: newsLinks } = await supabase
      .from("news_items")
      .select("policy_alert_id, published_at")
      .in("policy_alert_id", alertIds);
    for (const n of (newsLinks ?? []) as Array<{ policy_alert_id: string; published_at: string }>) {
      if (n.policy_alert_id && !newsByAlertId.has(n.policy_alert_id)) {
        newsByAlertId.set(n.policy_alert_id, n.published_at);
      }
    }
  }
  const billIds = rawAlerts.map((a) => a.bill_id).filter(Boolean) as string[];
  const billLastActionByBillId = new Map<string, string>();
  if (billIds.length > 0) {
    const { data: bs } = await supabase
      .from("bills")
      .select("id, last_action_at")
      .in("id", billIds);
    for (const b of (bs ?? []) as Array<{ id: string; last_action_at: string | null }>) {
      if (b.last_action_at) billLastActionByBillId.set(b.id, b.last_action_at);
    }
  }
  // Dedup news via shared lib (src/lib/news-dedup.ts) — strips outlet
  // suffixes (News12 affiliates, Newsday, AOL/MSN echoes) and keeps the
  // earliest-published copy of each story as canonical.
  const news = dedupNews((newsRaw.data ?? []) as NewsItem[], 12);

  const STATE_FRESH_DAYS = 30;
  const STATE_FRESH_MS = STATE_FRESH_DAYS * 86_400_000;
  const freshAlerts = rawAlerts.filter((a) => {
    let eventDate: Date | null = a.occurs_at ? new Date(a.occurs_at) : null;
    if (!eventDate) {
      const newsPub = newsByAlertId.get(a.id);
      if (newsPub) eventDate = new Date(newsPub);
    }
    if (!eventDate && a.bill_id) {
      const billPub = billLastActionByBillId.get(a.bill_id);
      if (billPub) eventDate = new Date(billPub);
    }
    if (!eventDate) eventDate = new Date(a.created_at);
    return Date.now() - eventDate.getTime() <= STATE_FRESH_MS;
  }).slice(0, 10);

  // Bucket bills: county/municipal-scope active fights surface FIRST
  // because they're concrete + actionable (a vote is happening soon
  // in your county vs an abstract state-bill-in-committee). State-scope
  // bills are split into "moving recently" (last 90 days) vs "tracked
  // but quiet" so the page doesn't drown a hot local fight under a
  // pile of stale state-scope bills.
  type BillRow = {
    id: string; bill_number: string; title: string | null; status: string | null;
    kratom_relevance: string | null; last_action: string | null; last_action_at: string | null;
    scope: string | null; locality: string | null;
  };
  const allBills = (bills.data ?? []) as BillRow[];
  const RECENT_STATE_DAYS = 90;
  const recentCutoff = Date.now() - RECENT_STATE_DAYS * 86_400_000;
  const localFights = allBills.filter(b => b.scope === "county" || b.scope === "municipal");
  const movingStateBills = allBills.filter(b =>
    b.scope === "state"
    && b.last_action_at != null
    && new Date(b.last_action_at).getTime() >= recentCutoff
  );
  const quietStateBills = allBills.filter(b =>
    b.scope === "state"
    && (b.last_action_at == null || new Date(b.last_action_at).getTime() < recentCutoff)
  );

  const totalSignals = allBills.length
    + (meetings.data?.length ?? 0)
    + (pastMeetings.data?.length ?? 0)
    + freshAlerts.length
    + (campaigns.data?.length ?? 0);

  // Schema.org WebPage with CollectionPage mainEntity — describes this
  // as a state-policy hub for AI summarizers and search engines. The
  // mainEntity carries the actual content classification so AI agents
  // can answer 'what's happening with kratom in TX?' by citing us.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `Kratom policy in ${stateName}`,
    description: `Every active kratom-policy signal we're tracking for ${stateName}: bills, hearings, municipal meetings, alerts, campaigns.`,
    url: `${SITE}/states/${codeUpper}`,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    isPartOf: { "@type": "WebSite", name: "iKratom", url: SITE },
    about: {
      "@type": "AdministrativeArea",
      name: stateName,
      identifier: codeUpper,
      addressCountry: "US",
    },
    mainEntity: {
      "@type": "CollectionPage",
      numberOfItems: totalSignals,
      itemListElement: [
        ...((bills.data ?? []).slice(0, 5).map((b: { id: string; bill_number: string; title: string | null }) => ({
          "@type": "Legislation",
          name: `${codeUpper} ${b.bill_number}`,
          description: b.title?.slice(0, 200),
          url: `${SITE}/bills/${b.id}`,
          legislationJurisdiction: { "@type": "AdministrativeArea", name: stateName },
        }))),
        ...((meetings.data ?? []).slice(0, 5).map((m: { id: string; locality: string | null; body_name: string | null; meeting_at: string }) => ({
          "@type": "Event",
          name: `${m.locality ?? codeUpper} ${m.body_name ?? "meeting"}`,
          startDate: m.meeting_at,
          url: `${SITE}/meetings/${m.id}`,
        }))),
      ],
    },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Link href="/states" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All states
      </Link>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📍 {codeUpper} · {stateName}
        </p>
        <h1 className="mt-2 text-4xl font-bold">Kratom policy in {stateName}</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every active signal we&apos;re tracking for {stateName}: bills, hearings,
          municipal meetings, recent alerts, and the campaigns where you can
          take one-click action.
        </p>

        {/* Answer-first canonical status (Mission Control). Hidden until the
            derivation has populated state_status for this state. */}
        <StatusHeader status={stateStatus} billHrefs={statusBillHrefs} />

        {/* Threat-tier snapshot — surfaces the composite-scorer counts
            for this state so users see exactly how much work is to be
            done. Each chip links into the threat matrix filtered to
            that tier in this state. */}
        {actionableThreatCount > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            {threatStats.active_opponent > 0 && (
              <Link
                href={`/intel/threat-matrix?state=${codeUpper}&tier=active_opponent`}
                className="rounded border border-red-500 bg-red-950/30 px-2 py-1 font-semibold text-red-200 hover:bg-red-950/50"
                title="Hostile stance + restrictive sponsorship. Organize counter-pressure."
              >
                🚨 {threatStats.active_opponent} active opponent{threatStats.active_opponent === 1 ? "" : "s"}
              </Link>
            )}
            {threatStats.hostile_decision_maker > 0 && (
              <Link
                href={`/intel/threat-matrix?state=${codeUpper}&tier=hostile_decision_maker`}
                className="rounded border border-red-700/60 bg-red-950/20 px-2 py-1 font-semibold text-red-200 hover:bg-red-950/40"
                title="Hostile + committee/bill power. Block procedurally."
              >
                ⚠ {threatStats.hostile_decision_maker} hostile decision-maker{threatStats.hostile_decision_maker === 1 ? "" : "s"}
              </Link>
            )}
            {threatStats.flippable_target > 0 && (
              <Link
                href={`/intel/threat-matrix?state=${codeUpper}&tier=flippable_target`}
                className="rounded border border-amber-500 bg-amber-950/30 px-2 py-1 font-semibold text-amber-200 hover:bg-amber-950/50"
                title="Unknown/neutral + on kratom-deciding committee + low conflicts. Highest conversion ROI."
              >
                🎯 {threatStats.flippable_target} flippable target{threatStats.flippable_target === 1 ? "" : "s"}
              </Link>
            )}
            {threatStats.champion > 0 && (
              <Link
                href={`/intel/threat-matrix?state=${codeUpper}&tier=champion`}
                className="rounded border border-emerald-500 bg-emerald-950/30 px-2 py-1 font-semibold text-emerald-200 hover:bg-emerald-950/50"
                title="Pro-kratom champions. Reinforce."
              >
                ⭐ {threatStats.champion} champion{threatStats.champion === 1 ? "" : "s"}
              </Link>
            )}
            {threatStats.sympathetic_ally > 0 && (
              <Link
                href={`/intel/threat-matrix?state=${codeUpper}&tier=sympathetic_ally`}
                className="rounded border border-emerald-700/60 bg-emerald-950/20 px-2 py-1 text-emerald-300 hover:bg-emerald-950/40"
                title="Sympathetic posture. Upgrade to primary sponsor."
              >
                🤝 {threatStats.sympathetic_ally} sympathetic
              </Link>
            )}
          </div>
        )}

        {/* Coordinated-operation chips for this state — surfaces which
            detected national patterns have bills here. Click for the
            single-cluster detail page filtered to this state's bills. */}
        {stateClusters.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            {stateClusters.map((c) => {
              const tone =
                c.posture === "restrictive" ? "border-red-700/40 bg-red-950/15 text-red-200" :
                c.posture === "protective" ? "border-emerald-700/40 bg-emerald-950/15 text-emerald-200" :
                c.posture === "regulatory" ? "border-amber-700/40 bg-amber-950/15 text-amber-200" :
                "border-zinc-700 bg-zinc-900/40 text-zinc-300";
              const emoji =
                c.posture === "restrictive" ? "🚫" :
                c.posture === "protective" ? "🛡" :
                c.posture === "regulatory" ? "⚖" : "↔";
              return (
                <Link
                  key={c.slug}
                  href={`/intel/operations/${c.slug}`}
                  className={`rounded border px-2 py-1 hover:opacity-90 ${tone}`}
                  title={`Part of nationwide ${c.name}. Click for the full operation.`}
                >
                  🕸 {emoji} {c.name.split("—")[0].trim().split("(")[0].trim()} · {c.bill_count}
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {totalSignals === 0 && (
            <span className="rounded border border-amber-700/40 bg-amber-950/15 px-3 py-1 text-amber-300">
              ⚠ No active signals in {codeUpper} right now — quiet is good.
            </span>
          )}
          {briefing.data?.published_at && (
            <Link
              href={`/briefings/state/${codeUpper}`}
              className="rounded border border-emerald-700/40 bg-emerald-950/15 px-3 py-1 text-emerald-300 hover:border-emerald-500"
            >
              📋 Full briefing
            </Link>
          )}
          <Link
            href={`/states/${codeUpper}/briefing`}
            className="rounded border border-emerald-500 bg-emerald-950/20 px-3 py-1 font-semibold text-emerald-300 hover:bg-emerald-950/40"
            data-event="open_state_briefing"
          >
            ◉ Intel briefing
          </Link>
          <Link
            href={`/intel/threat-matrix?state=${codeUpper}`}
            className="rounded border border-amber-500 bg-amber-950/20 px-3 py-1 font-semibold text-amber-300 hover:bg-amber-950/40"
            data-event="open_state_threat_matrix"
          >
            🎯 Threat matrix
          </Link>
          <Link
            href={`/calendar?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            📅 Calendar
          </Link>
          <Link
            href={`/pulse?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            🚨 Live pulse
          </Link>
          <Link
            href={`/calls?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            📞 Call targets
          </Link>
          <Link
            href={`/calendar/feed.ics?state=${codeUpper}`}
            className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
          >
            🔔 Subscribe to {codeUpper} calendar
          </Link>
        </div>
      </header>

      {/* Takeback intel banner — fires only for the 7 banning states
          (where opposition_summary_md is editorially populated). Surfaces
          the curated repeal plan directly from the state landing so an
          organizer in AL/AR/IN/RI/VT/WI/TN sees it without clicking
          through to /banned first. */}
      {takebackBill?.data && (
        <Link
          href={`/bills/${takebackBill.data.id}`}
          className="mb-6 block rounded-lg border-2 border-amber-700/50 bg-amber-950/15 p-4 hover:border-amber-400"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
              🎯 Takeback plan
            </span>
            <span className="text-[10px] text-zinc-500">
              {takebackBill.data.status === "passed_chamber" ? "imminent ban" : "enacted ban"} · {takebackBill.data.bill_number}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-zinc-100">
            {stateName} has curated repeal intel — who pushed the ban + named legislators + phased action plan
          </p>
          <p className="mt-1 text-[11px] text-amber-300">Open the full plan →</p>
        </Link>
      )}

      {/* Signup nudge — only renders for anonymous visitors. The state
          hub is a high-intent surface (someone deliberately landed on
          /states/TX), so the value prop is concrete: be the first TX
          advocate notified when something happens. */}
      <SignUpNudge context="state" stateCode={codeUpper} className="mb-8" />
      <EnablePushNudge context="state" stateCode={codeUpper} className="mb-8" />

      {/* State bills MOVING — last 90 days of legislative activity. */}
      {movingStateBills.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">
            State bills moving · {movingStateBills.length}
          </h2>
          <p className="mb-3 text-[11px] text-zinc-500">
            State-scope bills with legislative activity in the last 90 days.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {movingStateBills.map((b) => {
              const daysAgo = b.last_action_at ? Math.floor((Date.now() - new Date(b.last_action_at).getTime()) / 86_400_000) : null;
              return (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}`}
                    className={`block rounded-md border p-3 hover:border-emerald-500 ${
                      b.kratom_relevance === "anti"
                        ? "border-red-700/40 bg-red-950/10"
                        : "border-emerald-700/40 bg-emerald-950/10"
                    }`}
                  >
                    <p className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-zinc-100">{b.bill_number}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        b.kratom_relevance === "anti" ? "bg-red-950/40 text-red-300" : "bg-emerald-950/40 text-emerald-300"
                      }`}>
                        {b.kratom_relevance === "anti" ? "🚫 restrictive" : "✅ supportive"}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">{b.status}{daysAgo != null && ` · ${daysAgo}d`}</span>
                    </p>
                    {b.title && <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{b.title}</p>}
                    {b.last_action && (
                      <p className="mt-1 text-[10px] text-zinc-600">{b.last_action}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Local fights — county/municipal-scope active battles. Pinned at
          the top because they're concrete + actionable (e.g. Suffolk
          County Resolution 1279-2026 currently tabled; users in NY need
          to see this prominently). */}
      {localFights.length > 0 && (
        <section className="mb-8 rounded-lg border-2 border-red-700/40 bg-gradient-to-br from-red-950/20 to-zinc-950/40 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">
              🚨 Active local fights · {localFights.length}
            </h2>
            <span className="text-[10px] text-zinc-500">county + city ordinances</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">
            County and city-level kratom-ordinance fights happening in {stateName} right now. These are the moments where a small number of votes decides the outcome.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {localFights.map((b) => {
              const daysAgo = b.last_action_at ? Math.floor((Date.now() - new Date(b.last_action_at).getTime()) / 86_400_000) : null;
              return (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}`}
                    className="block rounded-md border-2 border-red-700/40 bg-zinc-950/60 p-3 hover:border-red-400"
                  >
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                        {b.scope}
                      </span>
                      <span className="font-mono text-xs font-bold text-zinc-100">{b.bill_number}</span>
                      {daysAgo != null && (
                        <span className="ml-auto text-[10px] text-zinc-500">{daysAgo}d ago</span>
                      )}
                    </p>
                    {b.locality && (
                      <p className="mt-1 text-xs font-semibold text-zinc-200">{b.locality}</p>
                    )}
                    {b.title && <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{b.title}</p>}
                    {b.last_action && (
                      <p className="mt-1 text-[10px] text-zinc-600 line-clamp-1">{b.last_action}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Active campaigns — after the bills sections per owner spec
          (state bills → local fights → campaigns). */}
      {(campaigns.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-300">
            Active campaigns
          </h2>
          <ul className="space-y-2">
            {(campaigns.data ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/campaigns/${c.slug}`}
                  className="block rounded-md border border-emerald-700/40 bg-emerald-950/15 p-4 hover:border-emerald-500"
                >
                  <p className="font-semibold text-zinc-100">{c.title}</p>
                  {c.blurb && <p className="mt-1 text-sm text-zinc-400">{c.blurb}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Your officials — collapsible directory with one-tap email/call
          (owner spec 2026-06-11: dropdowns inside the main dropdown). */}
      <StateOfficials state={codeUpper} stateName={stateName} />

      {/* State bills TRACKED but quiet — collapsed by default so the
          page leads with what's actually moving. */}
      {quietStateBills.length > 0 && (
        <section className="mb-8">
          <details className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
              Tracked but quiet (90+ days no action) · {quietStateBills.length}
            </summary>
            <p className="mt-2 text-[11px] text-zinc-500">
              These bills exist in the {stateName} legislature&apos;s system but haven&apos;t moved in 3+ months. Likely from a closed session or in a holding pattern. Useful context; not urgent.
            </p>
            <ul className="mt-3 grid gap-1 sm:grid-cols-2">
              {quietStateBills.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/bills/${b.id}`}
                    className="block rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] hover:border-zinc-600"
                  >
                    <span className="font-mono text-zinc-300">{b.bill_number}</span>
                    <span className={`ml-2 rounded px-1 py-0.5 text-[9px] uppercase ${
                      b.kratom_relevance === "anti" ? "text-red-400" : "text-emerald-400"
                    }`}>
                      {b.kratom_relevance}
                    </span>
                    {b.title && <span className="ml-2 text-zinc-500">— {b.title.slice(0, 60)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Recent past meetings (last 14 days, kratom-confirmed). Critical
          for the Suffolk County case: vote happened 2 days ago. The page
          would otherwise miss it entirely (the "next 90 days" filter only
          shows future meetings). */}
      {(pastMeetings.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-orange-300">
            Just happened · last 14 days
          </h2>
          <ul className="space-y-2">
            {(pastMeetings.data ?? []).map((m: { id: string; locality: string | null; body_name: string | null; meeting_at: string; agenda_url: string | null }) => {
              const when = new Date(m.meeting_at);
              const daysAgo = Math.floor((Date.now() - when.getTime()) / 86_400_000);
              return (
                <li key={m.id}>
                  <Link
                    href={`/meetings/${m.id}`}
                    className="block rounded-md border border-orange-700/40 bg-orange-950/15 p-3 hover:border-orange-500"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-orange-900/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-300">
                        {daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`}
                      </span>
                      <span className="font-semibold text-zinc-100">
                        {m.locality}{m.body_name ? ` · ${m.body_name}` : ""}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {when.toLocaleString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      Recent local meeting where kratom appeared on the agenda. Click for outcome + follow-up coverage.
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Upcoming meetings */}
      {(meetings.data ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-300">
            Upcoming meetings · next 90 days
          </h2>
          <ul className="space-y-2">
            {(meetings.data ?? []).map((m) => {
              const when = new Date(m.meeting_at);
              const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
              return (
                <li key={m.id}>
                  <Link
                    href={`/meetings/${m.id}`}
                    className="block rounded-md border border-amber-700/30 bg-amber-950/10 p-3 hover:border-amber-500"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                        in {days}d
                      </span>
                      <span className="font-semibold text-zinc-100">
                        {m.locality}{m.body_name ? ` · ${m.body_name}` : ""}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* State operators — legislators primary-sponsoring cluster-
          membered bills here. Shows who's running the local arm of
          the coordinated operations. Sorted by cluster-count then
          bill-count; ≥1 cluster filter. Limit 8. */}
      {stateOperators.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-red-300">
            🕸 State operators · who&apos;s running the operations here
          </h2>
          <p className="mb-3 text-[11px] text-zinc-500">
            Legislators primary-sponsoring bills in {codeUpper} that match a detected coordinated
            operation. Multi-operation operators are the most networked actors locally.
          </p>
          <ul className="space-y-1.5">
            {stateOperators.slice(0, 8).map((o) => (
              <li key={o.legislator_id} className="rounded border border-red-700/30 bg-red-950/10 px-3 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/legislators/${o.legislator_id}/briefing`} className="font-semibold text-red-100 hover:underline">
                    {o.full_name}
                  </Link>
                  <span className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-300">
                    {o.role.replace(/_/g, " ")}
                  </span>
                  {o.party && (
                    <span className="text-[10px] text-zinc-500">{o.party}</span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-zinc-300">
                    <strong>{o.cluster_slugs.length}</strong> op{o.cluster_slugs.length === 1 ? "" : "s"} · <strong>{o.bill_count}</strong> bill{o.bill_count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {o.cluster_slugs.slice(0, 4).map((slug) => (
                    <Link
                      key={slug}
                      href={`/intel/operations/${slug}`}
                      className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-zinc-300 hover:text-emerald-400"
                    >
                      {slug.replace(/_/g, " ")}
                    </Link>
                  ))}
                  {o.cluster_slugs.length > 4 && (
                    <span className="text-zinc-500">+ {o.cluster_slugs.length - 4} more</span>
                  )}
                </div>
              </li>
            ))}
            {stateOperators.length > 8 && (
              <li className="pt-1 text-[10px] text-zinc-500">
                + {stateOperators.length - 8} more state operators not shown.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Recent alerts */}
      {freshAlerts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-red-300">
            Recent alerts · last 30 days
          </h2>
          <ul className="space-y-2">
            {freshAlerts.map((a) => {
              const when = new Date(a.created_at);
              const daysAgo = Math.floor((Date.now() - when.getTime()) / 86_400_000);
              return (
                <li key={a.id} className={`rounded-md border p-3 ${
                  a.severity === "critical"
                    ? "border-red-700/40 bg-red-950/10"
                    : "border-amber-700/30 bg-amber-950/10"
                }`}>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs ${a.severity === "critical" ? "text-red-300" : "text-amber-300"}`}>
                      {a.severity === "critical" ? "🚨" : "⚠️"}
                    </span>
                    <p className="flex-1 text-sm font-semibold text-zinc-100">{a.title}</p>
                    <span className="text-[10px] text-zinc-500">{daysAgo}d ago</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* News coverage in this state — last 60d, deduped across syndicates.
          Same chain logic as /bills/[id] but state-wide rather than bill-
          scoped. Owner directive 2026-05-14: 'we have so much information
          that has context to correlate to each other... putting them
          together and telling their stories.' */}
      {news.length > 0 && (
        <section className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
              📰 News in {stateName} · {news.length}
            </h2>
            <span className="text-[10px] text-zinc-500">last 60 days, deduped</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Every news article we&apos;ve indexed mentioning kratom + {stateName}. Collapsed across syndicates (News12 affiliates, AOL/MSN echoes) to one entry per real story.
          </p>
          <ul className="mt-3 space-y-2">
            {news.map((n) => (
              <li key={n.id}>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
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
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">Want to organize in {stateName}?</p>
        <p className="mt-1">
          Sign up, pick &ldquo;{stateName}&rdquo; in your profile, and you&apos;ll get
          push notifications the moment a bill moves, a hearing is announced,
          or a city council puts kratom on the agenda.
          {" "}<Link href="/signup" className="font-semibold text-emerald-400 hover:underline">
            Join iKratom →
          </Link>
        </p>
      </footer>
    </div>
  );
}
