import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBillOfficialGroups, type BillOfficialGroups } from "@/modules/compose/bill-officials";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * /api/bills/[id]/viewer — everything on a bill page that differs per reader.
 *
 * WHY THIS EXISTS (2026-09-08). /bills/[id] had its whole public read set
 * cached already, yet stayed dynamic because four things were resolved per
 * request: whether the reader is signed in and subscribed, their federal
 * delegation, an RLS-scoped action count, and the committee-leverage table.
 * ~680 bill pages therefore re-queried Supabase on every crawler hit.
 *
 * THE COOKIE CLIENT IS LOAD-BEARING HERE, not an oversight. `legislator_stance`
 * is RLS-gated to verified/creator viewers, and the threat tiers below are
 * DERIVED from it. Running this under the reader's own session reproduces the
 * previous behaviour exactly: anon and unverified readers get stance-blind
 * tiers, verified readers get the full assessment. A service-role read here
 * would compute one privileged answer and — because the page that consumes it
 * is now cached — publish "active opponent" / "flippable target" labels about
 * named legislators to everyone. On a platform whose whole promise is
 * nonpartisanship that is the worst bug available, so it is called out rather
 * than left to be inferred from the client choice.
 *
 * Same reason `campaign_actions` is counted here: its RLS is self-scoped, so a
 * cached service-role count would show a reader a number that is not theirs.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CommitteeMember = {
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
  committee_role: string;
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

export type BillViewer = {
  signedIn: boolean;
  subscribed: boolean;
  totalActions: number;
  officialGroups: BillOfficialGroups | null;
  committeeMembers: CommitteeMember[];
};

const EMPTY: BillViewer = {
  signedIn: false,
  subscribed: false,
  totalActions: 0,
  officialGroups: null,
  committeeMembers: [],
};

const json = (body: BillViewer, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Validate BEFORE any query: this endpoint is reachable unauthenticated, so
    // an unvalidated id turns it into a free way to make the database work.
    if (!UUID_RE.test(id)) return json(EMPTY, 400);

    // Per-IP cap. Every read below is RLS-correct, so this is not about
    // authorisation — it is about not letting one client convert a cheap HTTP
    // request into a committee-wide join, repeatedly. Fails OPEN by design
    // (see lib/rate-limit): a rate limiter that takes the site down when its
    // own backing store hiccups is worse than the abuse it prevents.
    const ip = await getClientIp();
    if (!(await checkRateLimit(`bill-viewer:${ip}`, 120, 60))) {
      return json(EMPTY, 429);
    }

    const supabase = await createClient();

    const { data: billRow } = await supabase
      .from("bills")
      .select("id, state, scope, current_committee_name")
      .eq("id", id)
      .maybeSingle();
    if (!billRow) return json(EMPTY, 404);
    const bill = billRow as { id: string; state: string; scope: string | null; current_committee_name: string | null };

    const { data: { user: viewer } } = await supabase.auth.getUser();
    const signedIn = !!viewer;

    let subscribed = false;
    if (viewer) {
      const { data: sub } = await supabase
        .from("bill_subscriptions")
        .select("user_id")
        .eq("user_id", viewer.id)
        .eq("bill_id", bill.id)
        .maybeSingle();
      subscribed = !!sub;
    }

    // Federal "email your officials" needs the reader's OWN districts. State
    // and local scopes use the viewer-independent groups already baked into
    // the cached page, so they are not recomputed here.
    const isFederalBill = bill.scope === "federal" || bill.state === "US";
    let officialGroups: BillOfficialGroups | null = null;
    if (isFederalBill) {
      let viewerCivic: Parameters<typeof getBillOfficialGroups>[2] = null;
      if (viewer) {
        const { data: cp } = await supabase
          .from("profiles")
          .select("state, congressional_district, state_senate_district, state_house_district, city, county")
          .eq("id", viewer.id)
          .single();
        viewerCivic = (cp as typeof viewerCivic) ?? null;
      }
      officialGroups = await getBillOfficialGroups(
        supabase, { state: bill.state, scope: bill.scope }, viewerCivic,
      );
    }

    const { data: campaignRows } = await supabase
      .from("campaigns")
      .select("id")
      .eq("bill_id", bill.id);
    const campaignIds = (campaignRows ?? []).map((c) => (c as { id: string }).id);
    const { count: totalActions } = campaignIds.length > 0
      ? await supabase.from("campaign_actions")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", campaignIds)
      : { count: 0 };

    const committeeMembers = await buildCommitteeLeverage(supabase, bill);

    return json({
      signedIn,
      subscribed,
      totalActions: totalActions ?? 0,
      officialGroups,
      committeeMembers,
    });
  } catch {
    // Degrade to "no per-viewer extras" rather than 500. The bill page is
    // cached and already rendered; this must never be able to break it.
    return json(EMPTY);
  }
}

/**
 * Every member of the committee this bill sits in, ranked by threat tier.
 * Lifted verbatim from the page body so behaviour is unchanged — including
 * that it runs on the caller's own client, which is what keeps the stance
 * gating intact (see the header comment).
 */
async function buildCommitteeLeverage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bill: { state: string; current_committee_name: string | null },
): Promise<CommitteeMember[]> {
  const out: CommitteeMember[] = [];
  if (!bill.current_committee_name || !bill.state) return out;
  try {
    const { assessThreat } = await import("@/lib/legislator-threat-score");
    const { committeesMatch } = await import("@/lib/bill-committee");
    const { data: stateCommittees } = await supabase
      .from("legislator_committees")
      .select("legislator_id, committee_name, role, is_kratom_relevant, legislators!inner(id, full_name, state, role, district, party, phone, email, website, title, active)")
      .eq("legislators.state", bill.state)
      .eq("legislators.active", true)
      .limit(2000);

    type CmtRow = {
      legislator_id: string; committee_name: string; role: string;
      is_kratom_relevant: boolean | null;
      legislators: {
        id: string; full_name: string; state: string; role: string;
        district: string | null; party: string | null; phone: string | null;
        email: string | null; website: string | null; title: string | null; active: boolean;
      } | Array<{ id: string; full_name: string; state: string; role: string; district: string | null; party: string | null; phone: string | null; email: string | null; website: string | null; title: string | null; active: boolean }> | null;
    };
    const matched = ((stateCommittees ?? []) as CmtRow[]).filter((c) =>
      committeesMatch(bill.current_committee_name!, c.committee_name),
    );
    if (matched.length === 0) return out;

    const memberIds = matched.map((c) => c.legislator_id);
    const [stancesRes, sponsorsRes, donorsRes, tradesRes] = await Promise.all([
      supabase.from("legislator_stance").select("legislator_id, stance").eq("topic", "kratom").in("legislator_id", memberIds),
      supabase.from("bill_sponsors")
        .select("legislator_id, classification, bills!inner(kratom_relevance, active)")
        .in("legislator_id", memberIds).eq("bills.active", true),
      supabase.from("legislator_donors")
        .select("legislator_id, top_industries")
        .in("legislator_id", memberIds).eq("resolved_status", "matched"),
      supabase.from("federal_personal_trades")
        .select("legislator_id").in("legislator_id", memberIds).eq("is_kratom_adjacent", true),
    ]);

    const stanceByLeg = new Map<string, string>();
    for (const r of (stancesRes.data ?? []) as Array<{ legislator_id: string; stance: string }>) {
      stanceByLeg.set(r.legislator_id, r.stance);
    }
    type SpAgg = { primary_count: number; cosponsor_count: number; has_anti: boolean; has_pro: boolean; anti_primary: number; pro_primary: number };
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
      const indAmt = (name: string) => {
        if (!isFederalLeg) return null;
        return inds.find((i) => i.industry === name)?.amount ?? 0;
      };
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
      out.push({
        legislator_id: c.legislator_id,
        full_name: l.full_name, state: l.state, role: l.role,
        district: l.district, party: l.party, phone: l.phone,
        email: l.email, website: l.website, title: l.title,
        committee_role: c.role,
        tier: assess.tier, tier_label: assess.tier_label,
        tier_emoji: assess.tier_emoji, tier_color: assess.tier_color,
        threat_score: assess.threat_score,
        vulnerability_score: assess.vulnerability_score,
        has_anti_sponsorship: !!sp?.has_anti,
        has_pro_sponsorship: !!sp?.has_pro,
        rationale: assess.rationale,
      });
    }

    const TIER_ORDER: Record<string, number> = {
      active_opponent: 0, hostile_decision_maker: 1, flippable_target: 2,
      champion: 3, sympathetic_ally: 4, education_target: 5, low_priority: 6,
    };
    out.sort((a, b) => {
      if (a.committee_role === "chair" && b.committee_role !== "chair") return -1;
      if (b.committee_role === "chair" && a.committee_role !== "chair") return 1;
      const ta = TIER_ORDER[a.tier] ?? 9;
      const tb = TIER_ORDER[b.tier] ?? 9;
      if (ta !== tb) return ta - tb;
      return b.threat_score - a.threat_score;
    });
  } catch {
    // threat-score / bill-committee lib unavailable — silent, as before.
  }
  return out;
}
