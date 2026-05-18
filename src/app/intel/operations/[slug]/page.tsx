import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data } = await sb
    .from("bill_clusters")
    .select("name, summary_md, bill_count, state_count")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return { title: "Operation not found" };
  const c = data as { name: string; summary_md: string | null; bill_count: number; state_count: number };
  return {
    title: `${c.name} — coordinated kratom-policy operation`,
    description: `${c.bill_count} bills across ${c.state_count} states pushing the same model legislation. ${c.summary_md?.slice(0, 150) ?? ""}`,
    robots: { index: false },
  };
}

const POSTURE_TONE: Record<string, string> = {
  restrictive: "border-red-500/60 bg-red-950/15 text-red-200",
  protective: "border-emerald-500/50 bg-emerald-950/15 text-emerald-200",
  regulatory: "border-amber-500/60 bg-amber-950/15 text-amber-200",
  mixed: "border-zinc-700 bg-zinc-950/40 text-zinc-300",
};

const POSTURE_LABEL: Record<string, string> = {
  restrictive: "🚫 Restrictive",
  protective: "🛡 Protective",
  regulatory: "⚖ Regulatory",
  mixed: "↔ Mixed",
};

/**
 * /intel/operations/[slug] — per-cluster detail page.
 *
 * Single URL per detected operation so journalists / agency staffers /
 * advocates can deep-link to one specific pattern (e.g. "the 32-state
 * Schedule I criminalization push") without surrounding clutter.
 *
 * Same data the /intel/operations index page uses, scoped to one
 * cluster and rendered with more breathing room: full per-state bill
 * lists, complete signature-phrase set, full donor-industry breakdown,
 * full sponsor-stance distribution, full spread chronology.
 *
 * Print-friendly via /intel/operations/[slug]/dossier sub-route.
 */
export default async function ClusterDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();

  const { data: cluster } = await sb
    .from("bill_clusters")
    .select("id, slug, name, posture, summary_md, suspected_origin, signature_phrases, bill_count, state_count, earliest_introduced, latest_introduced, updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!cluster) notFound();
  const c = cluster as {
    id: string; slug: string; name: string; posture: string; summary_md: string | null;
    suspected_origin: string | null; signature_phrases: string[] | null;
    bill_count: number; state_count: number;
    earliest_introduced: string | null; latest_introduced: string | null;
    updated_at: string | null;
  };

  // Pull bills in this cluster
  const { data: membersRaw } = await sb
    .from("bill_cluster_members")
    .select("confidence, match_reason, bills!inner(id, state, bill_number, title, kratom_relevance, status, last_action_at, active, current_committee_name)")
    .eq("cluster_id", c.id)
    .eq("bills.active", true);

  type BillJoined = {
    id: string; state: string; bill_number: string; title: string | null;
    kratom_relevance: string | null; status: string | null;
    last_action_at: string | null; active: boolean; current_committee_name: string | null;
  };
  type MemberJoined = {
    confidence: number; match_reason: string | null;
    bills: BillJoined | BillJoined[] | null;
  };
  function normalizeBill(b: BillJoined | BillJoined[] | null): BillJoined | null {
    if (Array.isArray(b)) return b[0] ?? null;
    return b;
  }
  const billsInCluster: Array<{ bill: BillJoined; reason: string | null; confidence: number }> = [];
  for (const m of (membersRaw ?? []) as MemberJoined[]) {
    const b = normalizeBill(m.bills);
    if (!b) continue;
    billsInCluster.push({ bill: b, reason: m.match_reason, confidence: m.confidence });
  }

  // Group by state
  const billsByState = new Map<string, Array<{ bill: BillJoined; reason: string | null; confidence: number }>>();
  for (const e of billsInCluster) {
    if (!billsByState.has(e.bill.state)) billsByState.set(e.bill.state, []);
    billsByState.get(e.bill.state)!.push(e);
  }
  const statesSorted = [...billsByState.entries()].sort((a, b) => b[1].length - a[1].length);

  // Sister clusters — other clusters that share bills with this one.
  // Reveals the tactical bundling specific to this operation
  // (e.g. KCPA bills are also Age-21 bills 38% of the time).
  type SisterCluster = { slug: string; name: string; posture: string; shared: number };
  const sisters: SisterCluster[] = [];
  const billIdsForSister = billsInCluster.map((e) => e.bill.id);
  if (billIdsForSister.length > 0) {
    const { data: otherMembers } = await sb
      .from("bill_cluster_members")
      .select("bill_id, bill_clusters!inner(slug, name, posture)")
      .in("bill_id", billIdsForSister)
      .neq("cluster_id", c.id);
    type Joined = { slug: string; name: string; posture: string };
    const sisterMap = new Map<string, SisterCluster>();
    for (const m of (otherMembers ?? []) as Array<{
      bill_id: string; bill_clusters: Joined | Joined[] | null;
    }>) {
      const other = Array.isArray(m.bill_clusters) ? m.bill_clusters[0] : m.bill_clusters;
      if (!other) continue;
      const agg = sisterMap.get(other.slug) ?? { slug: other.slug, name: other.name, posture: other.posture, shared: 0 };
      agg.shared += 1;
      sisterMap.set(other.slug, agg);
    }
    sisters.push(...[...sisterMap.values()].sort((a, b) => b.shared - a.shared));
  }

  // Primary sponsors of bills in this cluster + their stance + donor industries
  const billIds = billsInCluster.map((e) => e.bill.id);
  let sponsorStanceDist: Record<string, number> = {};
  let donorIndustryRows: Array<{ industry: string; label: string; advocate_flag: boolean; amount: number; recipients: number }> = [];
  let federalSponsorCount = 0;
  if (billIds.length > 0) {
    const { data: sps } = await sb
      .from("bill_sponsors")
      .select("legislator_id, classification")
      .in("bill_id", billIds)
      .eq("classification", "primary");
    const distinctLegIds = [...new Set((sps ?? []).map((s) => s.legislator_id).filter((x): x is string => !!x))];
    if (distinctLegIds.length > 0) {
      const [stanceRes, donorRes] = await Promise.all([
        sb.from("legislator_kratom_stance").select("legislator_id, stance").in("legislator_id", distinctLegIds),
        sb.from("legislator_donors")
          .select("legislator_id, top_industries")
          .in("legislator_id", distinctLegIds)
          .eq("resolved_status", "matched"),
      ]);
      const stanceByLeg = new Map<string, string>();
      for (const s of (stanceRes.data ?? []) as Array<{ legislator_id: string; stance: string }>) {
        stanceByLeg.set(s.legislator_id, s.stance);
      }
      for (const legId of distinctLegIds) {
        const st = stanceByLeg.get(legId) ?? "unknown";
        sponsorStanceDist[st] = (sponsorStanceDist[st] ?? 0) + 1;
      }
      const industryMap = new Map<string, { amount: number; label: string; advocate_flag: boolean; recipients: number }>();
      type D = { legislator_id: string; top_industries: Array<{ industry: string; label?: string; advocate_flag?: boolean; amount: number }> | null };
      for (const d of (donorRes.data ?? []) as D[]) {
        federalSponsorCount += 1;
        for (const ind of d.top_industries ?? []) {
          if (!ind.industry || typeof ind.amount !== "number") continue;
          const cur = industryMap.get(ind.industry) ?? {
            amount: 0, label: ind.label ?? ind.industry,
            advocate_flag: !!ind.advocate_flag, recipients: 0,
          };
          cur.amount += ind.amount;
          cur.recipients += 1;
          industryMap.set(ind.industry, cur);
        }
      }
      donorIndustryRows = [...industryMap.entries()]
        .map(([id, x]) => ({ industry: id, ...x }))
        .filter((r) => r.amount >= 1_000)
        .sort((a, b) => b.amount - a.amount);
    }
  }

  // Chronology
  const perStateEarliest = [...billsByState.entries()].map(([state, entries]) => {
    const dates = entries.map((e) => e.bill.last_action_at).filter((d): d is string => !!d).sort();
    return { state, date: dates[0] ?? null, billCount: entries.length };
  });
  const chronological = perStateEarliest.filter((s) => s.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));

  const tone = POSTURE_TONE[c.posture] ?? POSTURE_TONE.mixed;
  const flaggedTotal = donorIndustryRows.filter((r) => r.advocate_flag).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel/operations" className="text-zinc-500 hover:text-emerald-400">
          ← All coordinated operations
        </Link>
      </div>

      <header className="mb-6 mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Coordinated operation
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{c.name}</h1>
        <div className="mt-2 flex flex-wrap items-baseline gap-2 text-xs">
          <span className={`rounded-full border px-2 py-0.5 font-bold uppercase tracking-wider ${tone}`}>
            {POSTURE_LABEL[c.posture] ?? c.posture}
          </span>
          <span className="rounded bg-zinc-900 px-2 py-0.5">
            <strong className="font-mono tabular-nums">{c.bill_count}</strong> bills · <strong className="font-mono tabular-nums">{c.state_count}</strong> states
          </span>
          {c.earliest_introduced && c.latest_introduced && (
            <span className="rounded bg-zinc-900 px-2 py-0.5">
              span: {c.earliest_introduced} → {c.latest_introduced}
            </span>
          )}
          <Link
            href={`/intel/operations/${c.slug}/dossier`}
            className="ml-auto rounded border border-emerald-700/40 bg-emerald-950/15 px-2.5 py-1 font-semibold text-emerald-300 hover:bg-emerald-950/30"
            title="Printable citation-ready 1-page report on this operation"
          >
            📄 Print dossier
          </Link>
        </div>
        {c.summary_md && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-300">
            {c.summary_md}
          </p>
        )}
        {c.suspected_origin && (
          <p className="mt-2 max-w-3xl text-[12px] italic text-zinc-400">
            <strong className="not-italic text-zinc-300">Suspected origin:</strong> {c.suspected_origin}
          </p>
        )}
      </header>

      {/* Signature phrases */}
      {Array.isArray(c.signature_phrases) && c.signature_phrases.length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Signature phrases · verbatim recurring text
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.signature_phrases.map((p) => (
              <code key={p} className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono text-zinc-200">
                &quot;{p}&quot;
              </code>
            ))}
          </div>
        </section>
      )}

      {/* Sister clusters — other operations that share bills with
          this one. Reveals tactical bundling: this cluster's bills
          often appear alongside these others. */}
      {sisters.length > 0 && (
        <section className="mb-6 rounded-lg border border-violet-700/30 bg-violet-950/10 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-violet-300">
            🔗 Sister clusters · operations bundled with this one
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Other detected operations whose bills also match this cluster&apos;s pattern. Bills
            appearing in both clusters indicate drafters bundling tactics — useful for reading
            intent (e.g. a KCPA framework bill that&apos;s also Age-21 is a different beast than
            either pattern alone).
          </p>
          <ul className="mt-2 space-y-1 text-[11px]">
            {sisters.slice(0, 6).map((s) => (
              <li key={s.slug} className="flex items-baseline gap-x-2 rounded border border-violet-700/20 bg-violet-950/5 px-2 py-1">
                <Link href={`/intel/operations/${s.slug}`} className="font-semibold text-violet-100 hover:underline">
                  {s.name.split("—")[0].trim().split("(")[0].trim()}
                </Link>
                <span className="text-zinc-500 text-[10px]">[{s.posture}]</span>
                <span className="ml-auto font-mono text-zinc-300">
                  <strong>{s.shared}</strong> shared bill{s.shared === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sponsor stance distribution */}
      {Object.keys(sponsorStanceDist).length > 0 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Primary sponsors backing this operation
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            {Object.values(sponsorStanceDist).reduce((a, b) => a + b, 0)} distinct legislators across {statesSorted.length} states. Stance is AI-drafted (where available); signal-derived from sponsorship when not.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["hostile", "neutral", "unknown", "sympathetic", "champion"] as const)
              .filter((s) => (sponsorStanceDist[s] ?? 0) > 0)
              .map((s) => {
                const emoji: Record<string, string> = {
                  hostile: "🚫", neutral: "⚖", unknown: "❓",
                  sympathetic: "🤝", champion: "⭐",
                };
                const tone: Record<string, string> = {
                  hostile: "border-red-700/40 bg-red-950/15 text-red-200",
                  neutral: "border-zinc-700 bg-zinc-900/40 text-zinc-300",
                  unknown: "border-zinc-700 bg-zinc-900/40 text-zinc-400",
                  sympathetic: "border-emerald-700/40 bg-emerald-950/15 text-emerald-200",
                  champion: "border-emerald-500/50 bg-emerald-950/20 text-emerald-200",
                };
                return (
                  <span key={s} className={`rounded border px-2 py-0.5 text-xs ${tone[s]}`}>
                    {emoji[s]} {sponsorStanceDist[s]} {s}
                  </span>
                );
              })}
          </div>
        </section>
      )}

      {/* Federal LDA lobbying overlap — filings that intersect the
          cluster's active window. Surfaces which DC firms / clients
          were federally lobbying on kratom while this state-level
          operation was spreading. Same-period activity isn't proof
          of causation, but the overlap is intel-worthy. */}
      {await (async () => {
        if (!c.earliest_introduced || !c.latest_introduced) return null;
        const { data: ldas } = await sb
          .from("lobbying_filings")
          .select("filing_year, filing_period_display, registrant_name, client_name, lobbyists, income, issue_descriptions")
          .eq("is_kratom_relevant", true)
          .gte("dt_posted", c.earliest_introduced)
          .lte("dt_posted", c.latest_introduced)
          .order("dt_posted", { ascending: false })
          .limit(30);
        const rows = (ldas ?? []) as Array<{
          filing_year: number | null; filing_period_display: string | null;
          registrant_name: string | null; client_name: string | null;
          lobbyists: unknown; income: number | null;
          issue_descriptions: string[] | null;
        }>;
        if (rows.length === 0) return null;
        const totalIncome = rows.reduce((s, r) => s + (Number(r.income) || 0), 0);
        const clients = new Set(rows.map((r) => r.client_name).filter(Boolean));
        const registrants = new Set(rows.map((r) => r.registrant_name).filter(Boolean));
        return (
          <section className="mb-6 rounded-lg border border-violet-700/40 bg-violet-950/15 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-violet-300">
              📜 Federal lobbying during this operation&apos;s active window
            </h2>
            <p className="mt-1 text-[11px] text-zinc-400">
              {rows.length} kratom-issue federal LDA filings between {c.earliest_introduced} and {c.latest_introduced}.
              {clients.size > 0 && <> {clients.size} client{clients.size === 1 ? "" : "s"}, {registrants.size} registrant{registrants.size === 1 ? "" : "s"}.</>}
              {totalIncome > 0 && <> Total disclosed income: <strong className="text-violet-200">${totalIncome.toLocaleString()}</strong>.</>}
            </p>
            <ul className="mt-2 space-y-0.5 text-[11px]">
              {rows.slice(0, 12).map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-zinc-900/40 py-0.5">
                  <span className="font-mono text-zinc-500">{r.filing_year}</span>
                  <span className="font-semibold">{r.client_name ?? "—"}</span>
                  <span className="text-zinc-500">via</span>
                  <span>{r.registrant_name ?? "—"}</span>
                  {r.income != null && r.income > 0 && (
                    <span className="ml-auto font-mono text-violet-200">${r.income.toLocaleString()}</span>
                  )}
                </li>
              ))}
              {rows.length > 12 && (
                <li className="pt-1 text-[10px] text-zinc-500">
                  + {rows.length - 12} more. See <Link href="/intel/lobbying" className="text-violet-300 hover:underline">/intel/lobbying</Link> for the full federal LDA index.
                </li>
              )}
            </ul>
          </section>
        );
      })()}

      {/* Donor industry overlap */}
      {donorIndustryRows.length > 0 && (
        <section className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/10 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            💰 Industry money behind this operation
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Across {federalSponsorCount} federal sponsor{federalSponsorCount === 1 ? "" : "s"} with matched OpenFEC data.
            {flaggedTotal > 0 && (
              <> Total from substance-policy-adjacent industries (⚠): <strong className="text-red-300">${flaggedTotal.toLocaleString()}</strong>.</>
            )}
          </p>
          <ul className="mt-2 space-y-1">
            {donorIndustryRows.slice(0, 14).map((r) => (
              <li
                key={r.industry}
                className={`flex flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-[11px] ${
                  r.advocate_flag ? "border border-red-700/40 bg-red-950/15 text-red-100" : "text-zinc-300"
                }`}
              >
                {r.advocate_flag && <span className="text-[10px] font-bold text-red-300">⚠</span>}
                <span className={r.advocate_flag ? "font-semibold" : ""}>{r.label}</span>
                <span className="text-[10px] text-zinc-500">({r.recipients} sponsor{r.recipients === 1 ? "" : "s"})</span>
                <span className="ml-auto font-mono tabular-nums">${r.amount.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Spread chronology */}
      {chronological.length > 1 && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Spread chronology
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            First in <strong className="text-zinc-200">{chronological[0].state}</strong> on{" "}
            {chronological[0].date ? new Date(chronological[0].date).toLocaleDateString() : "—"} ·{" "}
            spread to <strong>{chronological.length - 1}</strong> more state{chronological.length - 1 === 1 ? "" : "s"} through{" "}
            {chronological[chronological.length - 1].date ? new Date(chronological[chronological.length - 1].date!).toLocaleDateString() : "—"}.
          </p>
          <ol className="mt-2 flex flex-wrap gap-1 font-mono text-[10px]">
            {chronological.map((s) => (
              <li key={s.state} className="rounded bg-zinc-900/60 px-1.5 py-0.5">
                {s.date ? new Date(s.date).toISOString().slice(0, 7) : "?"}: <strong className="text-zinc-200">{s.state}</strong>
                {s.billCount > 1 && <span className="text-zinc-500">×{s.billCount}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* States + bills */}
      {statesSorted.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            All bills in this operation ({c.bill_count})
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {statesSorted.map(([state, entries]) => (
              <div key={state} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px]">
                <p className="font-mono font-bold uppercase text-zinc-200">
                  {state} · {entries.length} bill{entries.length === 1 ? "" : "s"}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {entries.map((e) => (
                    <li key={e.bill.id}>
                      <Link href={`/bills/${e.bill.id}`} className="hover:text-emerald-400 hover:underline">
                        <span className="font-mono text-zinc-300">{e.bill.bill_number}</span>
                        {e.bill.title && (
                          <span className="ml-2 text-zinc-400">
                            — {e.bill.title.slice(0, 70)}{e.bill.title.length > 70 ? "…" : ""}
                          </span>
                        )}
                      </Link>
                      {e.bill.status && (
                        <span className="ml-1 text-[10px] text-zinc-500">[{e.bill.status}]</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-8 text-[10px] text-zinc-600">
        Cluster last refreshed {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—"}. Detection
        runs daily via scripts/detect-bill-clusters.mjs. Built from public records: state legislature
        filings, OpenStates, OpenFEC, legislator stance drafts.
      </footer>
    </div>
  );
}
