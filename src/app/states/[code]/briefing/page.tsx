import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { committeesMatch } from "@/lib/bill-committee";
import {
  buildActionPlan,
  STANCE_META,
  type Stance,
  type LeverageSignal,
  type ActionPlan,
} from "@/lib/legislator-action-plan";

export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { code } = await params;
  const STATE = code.toUpperCase();
  return {
    title: `${STATE} kratom intel — legislator triage`,
    description: `Per-legislator intel briefing across ${STATE}: who's hostile, who's allied, who's deciding bills right now, and what to do about each.`,
    robots: { index: false }, // advocate-facing, not SEO
  };
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

/**
 * /states/[code]/briefing — per-state intel briefing.
 *
 * The "operations dashboard" view for advocates in a given state.
 * Pulls every legislator with any kratom signal (stance set, kratom-
 * relevant committee assignment, OR bill sponsorship) and triages
 * them into action buckets.
 *
 * Triage buckets:
 *   1. 🚨 Active opponents — hostile + primary anti-sponsorship
 *   2. ⚠ Hostile decision-makers — hostile + on kratom-relevant committee
 *   3. ⭐ Champions to reinforce — champion + pro-sponsorship
 *   4. 🤝 Sympathetic allies — sympathetic stance, need upgrade
 *   5. 🎯 Education targets — neutral + on kratom-relevant committee
 *   6. ❓ Unknown but in position — unknown + on kratom-relevant committee
 *
 * Each row shows one-line summary + leverage flags + link to the
 * full /legislators/[id]/briefing.
 *
 * Re-uses the rule-based action-plan engine from
 * src/lib/legislator-action-plan.ts so the bucketing logic stays
 * consistent with what the per-legislator page surfaces.
 */
export default async function StateBriefingPage({ params }: { params: Params }) {
  const { code } = await params;
  const STATE = code.toUpperCase();
  if (!STATE_NAMES[STATE]) notFound();
  const stateName = STATE_NAMES[STATE];

  const sb = await createClient();

  // ── Pull every legislator in state — we'll narrow by signal below
  const [legsRaw, stancesRaw, sponsorsRaw, billsRaw, committeesRaw] = await Promise.all([
    sb.from("legislators")
      .select("id, full_name, state, role, district, party, phone, email")
      .eq("state", STATE)
      .eq("active", true)
      .limit(2000),
    sb.from("legislator_kratom_stance")
      .select("legislator_id, stance"),
    sb.from("bill_sponsors")
      .select("bill_id, legislator_id, classification, bills!inner(state, kratom_relevance, current_committee_name)")
      .eq("bills.state", STATE),
    sb.from("bills")
      .select("id, bill_number, kratom_relevance, current_committee_name, last_action_at")
      .eq("state", STATE)
      .eq("active", true)
      .not("current_committee_name", "is", null)
      .limit(200),
    sb.from("legislator_committees")
      .select("legislator_id, committee_name, role, is_kratom_relevant"),
  ]);

  const allLegs = (legsRaw.data ?? []) as Array<{
    id: string; full_name: string; state: string; role: string;
    district: string | null; party: string | null;
    phone: string | null; email: string | null;
  }>;
  const legById = new Map(allLegs.map((l) => [l.id, l]));

  // Stance map
  const stanceByLeg = new Map<string, Stance>();
  for (const s of (stancesRaw.data ?? []) as Array<{ legislator_id: string; stance: Stance }>) {
    stanceByLeg.set(s.legislator_id, s.stance);
  }

  // Sponsorship aggregation
  type SponsorshipAgg = {
    primary_count: number;
    cosponsor_count: number;
    has_anti: boolean;
    has_pro: boolean;
  };
  const sponsorshipByLeg = new Map<string, SponsorshipAgg>();
  for (const s of (sponsorsRaw.data ?? []) as Array<{
    legislator_id: string;
    classification: string;
    bills: { state: string; kratom_relevance: string | null } | Array<unknown> | null;
  }>) {
    const b = Array.isArray(s.bills) ? (s.bills[0] as { state: string; kratom_relevance: string | null }) : s.bills;
    if (!b || (b as { state?: string }).state !== STATE) continue;
    const bill = b as { state: string; kratom_relevance: string | null };
    const agg = sponsorshipByLeg.get(s.legislator_id) ?? {
      primary_count: 0, cosponsor_count: 0, has_anti: false, has_pro: false,
    };
    if (s.classification === "primary") agg.primary_count++;
    else agg.cosponsor_count++;
    if (bill.kratom_relevance === "anti") agg.has_anti = true;
    if (bill.kratom_relevance === "pro") agg.has_pro = true;
    sponsorshipByLeg.set(s.legislator_id, agg);
  }

  // Committee membership per legislator — only legs whose state matches.
  // legislator_committees doesn't carry state, so we filter via legById.
  type CmtRow = { legislator_id: string; committee_name: string; role: string; is_kratom_relevant: boolean | null };
  const committeesByLeg = new Map<string, CmtRow[]>();
  for (const c of (committeesRaw.data ?? []) as CmtRow[]) {
    if (!legById.has(c.legislator_id)) continue;
    if (!committeesByLeg.has(c.legislator_id)) committeesByLeg.set(c.legislator_id, []);
    committeesByLeg.get(c.legislator_id)!.push(c);
  }

  // Bills currently in any committee
  const billsInCmt = (billsRaw.data ?? []) as Array<{
    id: string; bill_number: string; kratom_relevance: string | null;
    current_committee_name: string | null;
  }>;

  // Per-legislator: bills currently in their committees right now
  function billsDecidedByLeg(legId: string): typeof billsInCmt {
    const cmts = committeesByLeg.get(legId) ?? [];
    if (cmts.length === 0) return [];
    const out: typeof billsInCmt = [];
    const seen = new Set<string>();
    for (const b of billsInCmt) {
      if (!b.current_committee_name || seen.has(b.id)) continue;
      const match = cmts.find((c) => committeesMatch(b.current_committee_name!, c.committee_name));
      if (match) { out.push(b); seen.add(b.id); }
    }
    return out;
  }

  // ── Build per-legislator signal + plan, narrow to "has any signal"
  type Row = {
    leg: typeof allLegs[number];
    stance: Stance;
    sponsorship: SponsorshipAgg | null;
    isChairOfKratomRelevant: boolean;
    isMemberOfKratomRelevant: boolean;
    billsCount: number;
    plan: ActionPlan;
  };
  const rows: Row[] = [];
  for (const leg of allLegs) {
    const stance = stanceByLeg.get(leg.id) ?? "unknown";
    const sponsorship = sponsorshipByLeg.get(leg.id) ?? null;
    const cmts = committeesByLeg.get(leg.id) ?? [];
    const kratomCmts = cmts.filter((c) => c.is_kratom_relevant);
    const isChairOfKratomRelevant = kratomCmts.some((c) => c.role === "chair");
    const isMemberOfKratomRelevant = kratomCmts.length > 0;
    const bills = billsDecidedByLeg(leg.id);

    // Narrow to "has signal" — at least one of:
    //   non-unknown stance, sponsorship, kratom-relevant committee, active bills decided
    const hasSignal =
      stance !== "unknown" ||
      !!sponsorship ||
      isMemberOfKratomRelevant ||
      bills.length > 0;
    if (!hasSignal) continue;

    const signal: LeverageSignal = {
      isChairOfKratomRelevant,
      isMemberOfKratomRelevant,
      bills_in_their_committees_count: bills.length,
      primary_sponsorships: sponsorship?.primary_count ?? 0,
      cosponsorships: sponsorship?.cosponsor_count ?? 0,
      has_anti_sponsorship: !!sponsorship?.has_anti,
      has_pro_sponsorship: !!sponsorship?.has_pro,
      pharma_donations_usd: null, // state-level — donor data not pulled here
      alcohol_donations_usd: null,
      tobacco_donations_usd: null,
      is_user_rep: false, // computed per-viewer; not applicable at state-page render
    };
    const plan = buildActionPlan(stance, signal);
    rows.push({ leg, stance, sponsorship, isChairOfKratomRelevant, isMemberOfKratomRelevant, billsCount: bills.length, plan });
  }

  // ── Triage into buckets
  const buckets: Record<string, { title: string; emoji: string; tone: string; rows: Row[] }> = {
    active_opponents: { title: "Active opponents", emoji: "🚨", tone: "border-red-700/50 bg-red-950/15", rows: [] },
    hostile_decision_makers: { title: "Hostile decision-makers", emoji: "⚠", tone: "border-red-700/30 bg-red-950/10", rows: [] },
    champions_to_reinforce: { title: "Champions to reinforce", emoji: "⭐", tone: "border-emerald-500/50 bg-emerald-950/15", rows: [] },
    sympathetic_allies: { title: "Sympathetic allies", emoji: "🤝", tone: "border-emerald-700/40 bg-emerald-950/10", rows: [] },
    education_targets: { title: "Education targets", emoji: "🎯", tone: "border-amber-700/40 bg-amber-950/10", rows: [] },
    unknown_in_position: { title: "Unknown but in position", emoji: "❓", tone: "border-zinc-700 bg-zinc-950/40", rows: [] },
  };
  for (const r of rows) {
    if (r.stance === "hostile" && r.sponsorship?.has_anti) buckets.active_opponents.rows.push(r);
    else if (r.stance === "hostile" && r.isMemberOfKratomRelevant) buckets.hostile_decision_makers.rows.push(r);
    else if (r.stance === "champion") buckets.champions_to_reinforce.rows.push(r);
    else if (r.stance === "sympathetic") buckets.sympathetic_allies.rows.push(r);
    else if (r.stance === "neutral" && r.isMemberOfKratomRelevant) buckets.education_targets.rows.push(r);
    else if (r.stance === "unknown" && (r.isMemberOfKratomRelevant || r.billsCount > 0)) buckets.unknown_in_position.rows.push(r);
    // Everything else (e.g. champion-without-sponsorship, hostile-without-committee)
    // falls through; rows in those edge cases are rare and we'd rather under-show than mis-bucket.
  }

  // Sort within each bucket: chair > vice > member; bills-decided desc; primary-sponsorships desc
  const RANK = { chair: 0, vice_chair: 1, ranking_member: 2, member: 9 } as Record<string, number>;
  for (const b of Object.values(buckets)) {
    b.rows.sort((a, b2) => {
      if (a.isChairOfKratomRelevant !== b2.isChairOfKratomRelevant) {
        return a.isChairOfKratomRelevant ? -1 : 1;
      }
      if (a.billsCount !== b2.billsCount) return b2.billsCount - a.billsCount;
      return (b2.sponsorship?.primary_count ?? 0) - (a.sponsorship?.primary_count ?? 0);
    });
  }

  const totalSignalLegs = rows.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href={`/states/${STATE}`} className="text-zinc-500 hover:text-emerald-400">
          ← {stateName}
        </Link>
      </div>
      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ State intel briefing
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          {stateName} legislator triage
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Every legislator in {stateName} with any kratom signal, triaged into action buckets.
          {" "}{totalSignalLegs} of {allLegs.length} legislators have a stance set, a kratom-relevant committee position, or kratom-bill sponsorship history.
          {" "}Click any name for the full per-person briefing + action plan.
        </p>
        <p className="mt-2 text-[11px] text-zinc-600">
          Briefing pulls stance + committees + sponsorships + bills-currently-decided. State-level donor data not yet pulled (Phase 3).
        </p>
      </header>

      {Object.values(buckets).filter((b) => b.rows.length > 0).map((bucket) => (
        <section key={bucket.title} className={`mb-8 rounded-lg border-2 ${bucket.tone} p-5`}>
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <span className="text-lg">{bucket.emoji}</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
              {bucket.title}
            </h2>
            <span className="ml-1 text-xs text-zinc-500">{bucket.rows.length} legislator{bucket.rows.length === 1 ? "" : "s"}</span>
          </div>
          <ul className="space-y-2">
            {bucket.rows.map((r) => {
              const stanceMeta = STANCE_META[r.stance];
              return (
                <li key={r.leg.id}>
                  <Link
                    href={`/legislators/${r.leg.id}/briefing`}
                    className="block rounded-md border border-zinc-800 bg-zinc-950/30 p-3 transition hover:border-emerald-500"
                  >
                    <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stanceMeta.tone}`}>
                        {stanceMeta.emoji} {stanceMeta.label}
                      </span>
                      <span className="text-sm font-semibold text-zinc-100">{r.leg.full_name}</span>
                      {r.leg.party && <span className="text-zinc-500">({r.leg.party})</span>}
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-400">{r.leg.role.replace(/_/g, " ")}</span>
                      {r.leg.district && <span className="text-zinc-500">· District {r.leg.district}</span>}
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        r.plan.urgency === "high" ? "bg-red-500 text-zinc-950" :
                        r.plan.urgency === "medium" ? "bg-amber-500 text-zinc-950" :
                        "bg-zinc-800 text-zinc-300"
                      }`}>
                        {r.plan.urgency} priority
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-200">{r.plan.posture}</p>
                    {r.plan.leverage_flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.plan.leverage_flags.map((f, i) => (
                          <span
                            key={i}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              f.severity === "alarm" ? "bg-red-950/40 text-red-300" :
                              f.severity === "warn" ? "bg-amber-950/40 text-amber-300" :
                              f.severity === "win" ? "bg-emerald-950/40 text-emerald-300" :
                              "bg-zinc-900 text-zinc-400"
                            }`}
                            title={f.detail}
                          >
                            {f.emoji} {f.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {totalSignalLegs === 0 && (
        <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-center">
          <p className="text-3xl">🔍</p>
          <p className="mt-2 text-sm text-zinc-300">
            No legislators in {stateName} have a tracked kratom signal yet.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Stance drafting runs on a state-rotation cron. State of {STATE} may not be in the current priority set.
          </p>
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-800 pt-4 text-[11px] text-zinc-500">
        State briefing generated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC.
        Per-legislator action plans are rule-based — see <Link href="/legislators/" className="text-emerald-400 hover:underline">individual briefings</Link> for full talking points.
      </footer>
    </div>
  );
}
