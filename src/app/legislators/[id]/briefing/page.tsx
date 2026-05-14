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

  // ── Donor signals (federal only)
  type DonorJsonKratomRelevant = { pharma?: number; alcohol?: number; tobacco?: number; retail?: number; hospital_health?: number; total?: number };
  const donor = donorRow?.data as null | {
    cycle: number | null;
    total_receipts: number | null;
    top_industries: Array<{ industry: string; amount: number }> | null;
    top_employers: Array<{ employer: string; amount: number }> | null;
    kratom_relevant: DonorJsonKratomRelevant | null;
    resolved_status: string | null;
    synced_at: string | null;
  };
  const donorMatched = donor?.resolved_status === "matched";
  const pharma_usd = donorMatched ? (donor!.kratom_relevant?.pharma ?? null) : null;
  const alcohol_usd = donorMatched ? (donor!.kratom_relevant?.alcohol ?? null) : null;
  const tobacco_usd = donorMatched ? (donor!.kratom_relevant?.tobacco ?? null) : null;

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
    is_user_rep: isUserRep,
  };
  const plan = buildActionPlan(stance, signal);
  const stanceMeta = STANCE_META[stance];

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
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          One-page memo on this person&apos;s kratom posture, the leverage windows that exist right now, and what to do about them.
        </p>
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
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-amber-300 hover:text-amber-200">
                Top industries ▾
              </summary>
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {donor.top_industries.slice(0, 10).map((row, i) => (
                  <li key={i} className="flex justify-between text-zinc-400">
                    <span>{row.industry}</span>
                    <span className="font-mono tabular-nums text-zinc-300">${row.amount.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {donor.synced_at && (
            <p className="mt-3 text-[10px] text-zinc-600">
              FEC data synced {new Date(donor.synced_at).toLocaleDateString()}
            </p>
          )}
        </section>
      )}

      {/* ── Intel gaps ─────────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Intel gaps · what we don&apos;t have yet
        </h2>
        <ul className="space-y-1 text-xs text-zinc-400">
          {stance === "unknown" && !stanceRationale && (
            <li>· <span className="text-zinc-300">Stance assessment</span> — AI drafter hasn&apos;t run for this state yet, or the legislator has no kratom signal in our data.</li>
          )}
          {(leg.role === "us_senate" || leg.role === "us_house") && !donorMatched && (
            <li>· <span className="text-zinc-300">Federal donor profile</span> — FEC matching pending. Adam, the OpenFEC pipeline has a known matching gap; investigation in flight.</li>
          )}
          {!(leg.role === "us_senate" || leg.role === "us_house") && (
            <li>· <span className="text-zinc-300">Financial disclosures</span> — state-level lobbyist/donor data is not yet centralized in our system (50-state scraping effort).</li>
          )}
          <li>· <span className="text-zinc-300">Voting records</span> — roll-call votes aren&apos;t yet synced. Pipeline candidate via LegiScan API.</li>
          <li>· <span className="text-zinc-300">News mentions + sentiment</span> — we have news but don&apos;t per-legislator-index it yet.</li>
          <li>· <span className="text-zinc-300">Personal statements / press releases</span> — not scraped from official sites.</li>
        </ul>
        <p className="mt-3 text-[10px] text-zinc-600">
          Phase 2 of the briefing system will close these gaps. Admins can prioritize a specific legislator&apos;s enrichment via the request flow (forthcoming).
        </p>
      </section>

      <footer className="mt-10 border-t border-zinc-800 pt-4 text-[10px] text-zinc-500">
        Briefing generated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC.
        Action plan is rule-based, not AI-generated. Stance rationale (where present) is AI-drafted and admin-reviewable.
        Always verify critical facts against the legislator&apos;s official site before public communication.
      </footer>
    </div>
  );
}
