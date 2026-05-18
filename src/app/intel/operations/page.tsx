import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Coordinated operations — model legislation detector",
  description:
    "Kratom-policy adversaries operate from model legislation pushed simultaneously across multiple states. This page names every detected operation, lists every bill in each cluster, and exposes the operative language.",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

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
 * /intel/operations — the slam-dunk intel surface.
 *
 * Names every detected coordinated operation in kratom policy.
 * Adversaries don't operate state-by-state independently; they use
 * model legislation pushed simultaneously across states. This page
 * makes that visible.
 */
export default async function OperationsIntelPage() {
  const sb = await createClient();

  const { data: clusters } = await sb
    .from("bill_clusters")
    .select("id, slug, name, posture, summary_md, suspected_origin, signature_phrases, bill_count, state_count, earliest_introduced, latest_introduced, updated_at")
    .order("bill_count", { ascending: false });

  // Pull bill memberships once + group client-side
  const { data: members } = await sb
    .from("bill_cluster_members")
    .select("cluster_id, bill_id, confidence, match_reason, bills!inner(id, state, bill_number, title, kratom_relevance, scope, status, last_action_at, active)")
    .eq("bills.active", true);

  type BillJoined = {
    id: string; state: string; bill_number: string; title: string | null;
    kratom_relevance: string | null; scope: string | null; status: string | null;
    last_action_at: string | null; active: boolean;
  };
  type Member = {
    cluster_id: string;
    bill_id: string;
    confidence: number;
    match_reason: string | null;
    bills: BillJoined | BillJoined[] | null;
  };
  function normalizeBill(b: BillJoined | BillJoined[] | null): BillJoined | null {
    if (Array.isArray(b)) return b[0] ?? null;
    return b;
  }
  const membersByCluster = new Map<string, Array<{ bill: BillJoined; reason: string | null; confidence: number }>>();
  for (const m of (members ?? []) as Member[]) {
    const b = normalizeBill(m.bills);
    if (!b) continue;
    if (!membersByCluster.has(m.cluster_id)) membersByCluster.set(m.cluster_id, []);
    membersByCluster.get(m.cluster_id)!.push({ bill: b, reason: m.match_reason, confidence: m.confidence });
  }

  const totalBillsTracked = new Set(
    (members ?? []).map((m) => {
      const b = normalizeBill((m as Member).bills);
      return b?.id;
    }).filter(Boolean),
  ).size;

  // Per-cluster "active in last 180d" computation. Cross-references
  // each cluster's bills' last_action_at against the cutoff. Surfaces
  // which operations are running RIGHT NOW vs historical patterns.
  const RECENCY_DAYS = 180;
  const cutoff = new Date(Date.now() - RECENCY_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  type Recency = { bills_recent: number; latest_date: string };
  const recencyByCluster = new Map<string, Recency>();
  for (const [clusterId, ms] of membersByCluster.entries()) {
    let billsRecent = 0;
    let latest = "";
    for (const m of ms) {
      const d = m.bill.last_action_at;
      if (!d) continue;
      if (d >= cutoff) billsRecent += 1;
      if (d > latest) latest = d;
    }
    if (billsRecent > 0 || latest) {
      recencyByCluster.set(clusterId, { bills_recent: billsRecent, latest_date: latest });
    }
  }

  // Sponsor-stance distribution per cluster. Pulls primary sponsors
  // across all clustered bills + their drafted stance (when available),
  // then aggregates per cluster: how many champion / sympathetic /
  // hostile / unknown primary-sponsor legs back this operation?
  // Surfaces the human network behind each model-legislation pattern.
  type SponsorAgg = {
    total: number;
    by_stance: Record<string, number>;
    states: Set<string>;
  };
  const sponsorAggByCluster = new Map<string, SponsorAgg>();
  // Per-cluster donor industry rollups across federal sponsors with
  // matched OpenFEC data. Populated alongside the stance walk below.
  type DonorAgg = {
    by_industry: Map<string, { amount: number; label: string; advocate_flag: boolean; recipients: number }>;
    donor_sponsor_count: number;
  };
  const donorAggByCluster = new Map<string, DonorAgg>();
  for (const [clusterId, ms] of membersByCluster.entries()) {
    sponsorAggByCluster.set(clusterId, { total: 0, by_stance: {}, states: new Set() });
    for (const m of ms) {
      sponsorAggByCluster.get(clusterId)!.states.add(m.bill.state);
    }
  }
  {
    const allClusterBillIds = [
      ...new Set(
        (members ?? [])
          .map((m) => normalizeBill((m as Member).bills)?.id)
          .filter((x): x is string => !!x),
      ),
    ];
    if (allClusterBillIds.length > 0) {
      const { data: sps } = await sb
        .from("bill_sponsors")
        .select("bill_id, legislator_id, classification")
        .in("bill_id", allClusterBillIds)
        .eq("classification", "primary");
      const sponsorLegIds = [
        ...new Set((sps ?? []).map((s) => s.legislator_id).filter((x): x is string => !!x)),
      ];
      const stanceByLeg = new Map<string, string>();
      if (sponsorLegIds.length > 0) {
        const { data: stances } = await sb
          .from("legislator_kratom_stance")
          .select("legislator_id, stance")
          .in("legislator_id", sponsorLegIds);
        for (const s of (stances ?? []) as Array<{ legislator_id: string; stance: string }>) {
          stanceByLeg.set(s.legislator_id, s.stance);
        }
      }
      // Map bill_id → clusters that contain it
      const clustersByBill = new Map<string, Set<string>>();
      for (const m of (members ?? []) as Member[]) {
        const b = normalizeBill(m.bills);
        if (!b) continue;
        if (!clustersByBill.has(b.id)) clustersByBill.set(b.id, new Set());
        clustersByBill.get(b.id)!.add(m.cluster_id);
      }
      // Walk sponsors → for each cluster the bill belongs to, increment
      // sponsor counts under the legislator's stance bucket. A legislator
      // co-listed on multiple bills in the same cluster only counts once.
      const seenLegPerCluster = new Map<string, Set<string>>();
      for (const s of (sps ?? []) as Array<{ bill_id: string; legislator_id: string }>) {
        const clusters = clustersByBill.get(s.bill_id) ?? new Set();
        const stance = stanceByLeg.get(s.legislator_id) ?? "unknown";
        for (const cid of clusters) {
          if (seenLegPerCluster.has(cid) && seenLegPerCluster.get(cid)!.has(s.legislator_id)) continue;
          if (!seenLegPerCluster.has(cid)) seenLegPerCluster.set(cid, new Set());
          seenLegPerCluster.get(cid)!.add(s.legislator_id);
          const agg = sponsorAggByCluster.get(cid);
          if (!agg) continue;
          agg.total += 1;
          agg.by_stance[stance] = (agg.by_stance[stance] ?? 0) + 1;
        }
      }

      // ── Per-cluster donor industry aggregation
      // Follow the money: for the federal sponsors backing each
      // operation, sum the substance-policy-adjacent industry
      // contributions. Reveals "Schedule I criminalization is backed
      // by sponsors who collectively received $X from addiction
      // treatment + $Y from pharma." State legislators don't have
      // OpenFEC donor data so the federal subset surfaces here when
      // the cluster has federal sponsors.
      if (sponsorLegIds.length > 0) {
        const { data: donors } = await sb
          .from("legislator_donors")
          .select("legislator_id, top_industries")
          .in("legislator_id", sponsorLegIds)
          .eq("resolved_status", "matched");
        type DonorRow = {
          legislator_id: string;
          top_industries: Array<{ industry: string; label?: string; advocate_flag?: boolean; amount: number }> | null;
        };
        const donorByLeg = new Map<string, DonorRow["top_industries"]>();
        for (const d of (donors ?? []) as DonorRow[]) {
          donorByLeg.set(d.legislator_id, d.top_industries ?? []);
        }
        const seenDonorPerCluster = new Map<string, Set<string>>();
        for (const s of (sps ?? []) as Array<{ bill_id: string; legislator_id: string }>) {
          if (!donorByLeg.has(s.legislator_id)) continue;
          const clusters = clustersByBill.get(s.bill_id) ?? new Set();
          for (const cid of clusters) {
            if (seenDonorPerCluster.has(cid) && seenDonorPerCluster.get(cid)!.has(s.legislator_id)) continue;
            if (!seenDonorPerCluster.has(cid)) seenDonorPerCluster.set(cid, new Set());
            seenDonorPerCluster.get(cid)!.add(s.legislator_id);
            const inds = donorByLeg.get(s.legislator_id) ?? [];
            const agg = donorAggByCluster.get(cid) ?? {
              by_industry: new Map<string, { amount: number; label: string; advocate_flag: boolean; recipients: number }>(),
              donor_sponsor_count: 0,
            };
            agg.donor_sponsor_count += 1;
            for (const ind of inds ?? []) {
              if (!ind.industry || typeof ind.amount !== "number") continue;
              const cur = agg.by_industry.get(ind.industry) ?? {
                amount: 0, label: ind.label ?? ind.industry,
                advocate_flag: !!ind.advocate_flag, recipients: 0,
              };
              cur.amount += ind.amount;
              cur.recipients += 1;
              agg.by_industry.set(ind.industry, cur);
            }
            donorAggByCluster.set(cid, agg);
          }
        }
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">
          ← Intel hub
        </Link>
      </div>

      <header className="mb-8">
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Coordinated operations
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Model legislation, named + traced
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Kratom-policy adversaries don&apos;t operate state-by-state independently. They use{" "}
          <strong className="text-zinc-200">model legislation</strong> — the same operative
          language pushed in multiple states simultaneously by lobbyist networks. This page
          names every detected operation, lists every bill in each cluster, and exposes the
          recurring signature phrases.
        </p>
        <p className="mt-2 max-w-3xl text-[11px] text-zinc-500">
          {clusters?.length ?? 0} operations detected · {totalBillsTracked.toLocaleString()} bills cluster-linked
          across the corpus. Detection is automated by{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5">scripts/detect-bill-clusters.mjs</code>{" "}
          via curated editorial signatures (regex on bill text + summary). Bills can belong
          to multiple clusters when they span tactics.
        </p>
      </header>

      <section className="mb-8 space-y-6">
        {(clusters ?? []).map((c) => {
          const cMembers = membersByCluster.get(c.id) ?? [];
          const billsByState = new Map<string, Array<{ bill: BillJoined; reason: string | null; confidence: number }>>();
          for (const m of cMembers) {
            if (!billsByState.has(m.bill.state)) billsByState.set(m.bill.state, []);
            billsByState.get(m.bill.state)!.push(m);
          }
          const states = [...billsByState.entries()].sort((a, b) => b[1].length - a[1].length);
          const tone = POSTURE_TONE[c.posture] ?? POSTURE_TONE.mixed;

          return (
            <article
              key={c.id}
              id={c.slug}
              className={`rounded-lg border p-5 scroll-mt-20 ${tone}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-xl font-bold">
                  <Link href={`/intel/operations/${c.slug}`} className="hover:underline">
                    {c.name}
                  </Link>
                </h2>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
                  {POSTURE_LABEL[c.posture] ?? c.posture}
                </span>
                <Link
                  href={`/intel/operations/${c.slug}/dossier`}
                  className="ml-2 rounded border border-emerald-700/40 bg-emerald-950/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-950/30"
                  title="Printable citation-ready dossier"
                >
                  📄 Print
                </Link>
                <span className="ml-auto text-[11px] opacity-80">
                  <strong className="font-mono tabular-nums">{c.bill_count}</strong> bills ·{" "}
                  <strong className="font-mono tabular-nums">{c.state_count}</strong> states
                </span>
              </div>

              {(() => {
                const r = recencyByCluster.get(c.id);
                if (!r) return null;
                if (r.bills_recent > 0) {
                  return (
                    <div className="mt-2 inline-flex items-center gap-1 rounded border border-rose-700/40 bg-rose-950/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                      ⚡ Active · {r.bills_recent} bill{r.bills_recent === 1 ? "" : "s"} touched in last {RECENCY_DAYS}d
                    </div>
                  );
                }
                if (r.latest_date) {
                  return (
                    <div className="mt-2 inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-0.5 text-[10px] text-zinc-500">
                      Historical · latest activity {r.latest_date.slice(0, 7)}
                    </div>
                  );
                }
                return null;
              })()}

              {c.summary_md && (
                <p className="mt-3 text-sm leading-relaxed">
                  {c.summary_md}
                </p>
              )}

              {c.suspected_origin && (
                <p className="mt-2 text-[12px] italic text-zinc-300">
                  <strong className="not-italic text-zinc-100">Suspected origin:</strong>{" "}
                  {c.suspected_origin}
                </p>
              )}

              {(() => {
                const agg = sponsorAggByCluster.get(c.id);
                if (!agg || agg.total === 0) return null;
                const order = ["hostile", "neutral", "unknown", "sympathetic", "champion"] as const;
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
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
                      Primary sponsors backing this operation ({agg.total} distinct legislators)
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {order
                        .filter((s) => (agg.by_stance[s] ?? 0) > 0)
                        .map((s) => (
                          <span
                            key={s}
                            className={`rounded border px-2 py-0.5 text-[10px] ${tone[s]}`}
                          >
                            {emoji[s]} {agg.by_stance[s]} {s}
                          </span>
                        ))}
                    </div>
                  </div>
                );
              })()}

              {/* Per-cluster donor overlap — follow the money one
                  layer deeper. Sums substance-policy-adjacent industry
                  contributions across federal sponsors of bills in
                  this cluster. State legislators don't have OpenFEC
                  donor data so this surfaces only when the cluster
                  includes federal sponsors. ⚠ on the seven
                  advocate-flagged industries. */}
              {(() => {
                const da = donorAggByCluster.get(c.id);
                if (!da || da.donor_sponsor_count === 0) return null;
                const rows = [...da.by_industry.entries()]
                  .map(([id, x]) => ({ industry: id, ...x }))
                  .filter((r) => r.amount >= 1_000)
                  .sort((a, b) => b.amount - a.amount)
                  .slice(0, 8);
                if (rows.length === 0) return null;
                const flaggedTotal = rows
                  .filter((r) => r.advocate_flag)
                  .reduce((sum, r) => sum + r.amount, 0);
                return (
                  <div className="mt-3 rounded border border-amber-700/30 bg-amber-950/10 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                      💰 Industry money behind this operation
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-400">
                      Across {da.donor_sponsor_count} federal sponsor{da.donor_sponsor_count === 1 ? "" : "s"} with matched OpenFEC data
                      {flaggedTotal > 0 && (
                        <> · <strong className="text-red-300">${flaggedTotal.toLocaleString()}</strong> from substance-policy-adjacent industries (⚠)</>
                      )}
                    </p>
                    <ul className="mt-1.5 space-y-0.5">
                      {rows.map((r) => (
                        <li
                          key={r.industry}
                          className={`flex flex-wrap items-baseline gap-x-2 rounded px-2 py-0.5 text-[11px] ${
                            r.advocate_flag ? "border border-red-700/40 bg-red-950/15 text-red-100" : "text-zinc-300"
                          }`}
                        >
                          {r.advocate_flag && <span className="text-[10px] font-bold text-red-300">⚠</span>}
                          <span className={r.advocate_flag ? "font-semibold" : ""}>{r.label}</span>
                          <span className="text-[10px] text-zinc-500">
                            ({r.recipients} sponsor{r.recipients === 1 ? "" : "s"})
                          </span>
                          <span className="ml-auto font-mono tabular-nums">
                            ${r.amount.toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {/* Spread chronology — when did this operation first
                  appear in each state, sorted oldest-first? Detects
                  concurrent-introduction windows (>= 3 bills within
                  30 days across different states) as a coordinated-
                  push alarm. */}
              {(() => {
                const perStateEarliest = [...billsByState.entries()].map(([state, entries]) => {
                  const dates = entries
                    .map((e) => e.bill.last_action_at)
                    .filter((d): d is string => !!d)
                    .sort();
                  return { state, date: dates[0] ?? null, billCount: entries.length };
                });
                const chronological = perStateEarliest
                  .filter((s) => s.date)
                  .sort((a, b) => (a.date! < b.date! ? -1 : 1));
                if (chronological.length < 2) return null;

                // Concurrent-introduction window detection: any
                // 30-day rolling window containing ≥ 3 distinct states
                const WINDOW_DAYS = 30;
                const CONCURRENT_MIN = 3;
                const concurrentWindows: Array<{ start: string; end: string; states: string[] }> = [];
                for (let i = 0; i < chronological.length; i++) {
                  const start = chronological[i].date!;
                  const startMs = new Date(start).getTime();
                  const inWindow = [chronological[i]];
                  for (let j = i + 1; j < chronological.length; j++) {
                    const candidate = chronological[j];
                    if (!candidate.date) continue;
                    const diffDays = (new Date(candidate.date).getTime() - startMs) / 86400_000;
                    if (diffDays <= WINDOW_DAYS) inWindow.push(candidate);
                    else break;
                  }
                  if (inWindow.length >= CONCURRENT_MIN) {
                    concurrentWindows.push({
                      start,
                      end: inWindow[inWindow.length - 1].date!,
                      states: inWindow.map((w) => w.state),
                    });
                  }
                }
                // Dedupe overlapping windows: keep only the largest
                // sliding window per cluster start
                const dedupedWindows = concurrentWindows
                  .sort((a, b) => b.states.length - a.states.length)
                  .filter((w, idx, all) =>
                    !all.slice(0, idx).some((w2) =>
                      w2.states.length >= w.states.length &&
                      w.states.every((s) => w2.states.includes(s)),
                    ),
                  )
                  .slice(0, 3);

                const first = chronological[0];
                const last = chronological[chronological.length - 1];
                const spanDays = first.date && last.date
                  ? Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400_000)
                  : 0;

                return (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
                      Spread chronology
                    </p>
                    <p className="mt-1 text-[11px] opacity-90">
                      First in <strong className="font-mono">{first.state}</strong>{" "}
                      ({first.date ? new Date(first.date).toLocaleDateString() : "—"})
                      {chronological.length > 1 && (
                        <>
                          ; spread to <strong>{chronological.length - 1}</strong> more state{chronological.length - 1 === 1 ? "" : "s"} over <strong>{Math.max(spanDays, 1)}</strong> days.
                        </>
                      )}
                    </p>
                    {dedupedWindows.length > 0 && (
                      <div className="mt-2 rounded border border-red-700/40 bg-red-950/15 p-2 text-[10px] text-red-100">
                        <p className="font-semibold uppercase tracking-wider">
                          🚨 Concurrent-push windows detected
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {dedupedWindows.map((w, i) => (
                            <li key={i}>
                              <span className="font-mono">{w.states.length} states</span>{" "}
                              ({w.states.join(", ")}) introduced within{" "}
                              <span className="font-mono">
                                {new Date(w.start).toLocaleDateString()} → {new Date(w.end).toLocaleDateString()}
                              </span>
                              {" "}— industry-coordinated push signal.
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <details className="mt-2 text-[10px]">
                      <summary className="cursor-pointer opacity-70 hover:opacity-100">
                        Full state-by-state timeline ▾
                      </summary>
                      <ol className="mt-1.5 flex flex-wrap gap-1 font-mono">
                        {chronological.map((s) => (
                          <li
                            key={s.state}
                            className="rounded bg-zinc-900/40 px-1.5 py-0.5"
                            title={`${s.billCount} bill${s.billCount === 1 ? "" : "s"} in ${s.state}`}
                          >
                            {s.date ? new Date(s.date).toISOString().slice(0, 7) : "?"}: <strong>{s.state}</strong>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                );
              })()}

              {Array.isArray(c.signature_phrases) && c.signature_phrases.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
                    Signature phrases
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {c.signature_phrases.slice(0, 8).map((p: string) => (
                      <code
                        key={p}
                        className="rounded bg-zinc-900/40 px-1.5 py-0.5 text-[11px] font-mono"
                      >
                        &quot;{p}&quot;
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {states.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider opacity-80 hover:opacity-100">
                    States in this operation ({states.length}) ▾
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {states.map(([state, entries]) => (
                      <div
                        key={state}
                        className="rounded border border-zinc-800/60 bg-zinc-950/40 p-2 text-[11px]"
                      >
                        <p className="font-mono font-bold uppercase text-zinc-200">
                          {state} · {entries.length} bill{entries.length === 1 ? "" : "s"}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {entries.slice(0, 6).map((e) => (
                            <li key={e.bill.id}>
                              <Link
                                href={`/bills/${e.bill.id}`}
                                className="hover:text-emerald-400 hover:underline"
                              >
                                <span className="font-mono text-zinc-300">{e.bill.bill_number}</span>
                                {e.bill.title && (
                                  <span className="ml-2 text-zinc-400">
                                    — {e.bill.title.slice(0, 60)}{e.bill.title.length > 60 ? "…" : ""}
                                  </span>
                                )}
                              </Link>
                            </li>
                          ))}
                          {entries.length > 6 && (
                            <li className="text-[10px] text-zinc-500">
                              + {entries.length - 6} more in this state
                            </li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <p className="mt-3 text-[10px] text-zinc-500">
                {c.earliest_introduced && c.latest_introduced && (
                  <>
                    Active legislation in this cluster spans{" "}
                    <span className="font-mono text-zinc-400">{c.earliest_introduced}</span> →{" "}
                    <span className="font-mono text-zinc-400">{c.latest_introduced}</span>.
                  </>
                )}{" "}
                Cluster last refreshed{" "}
                {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—"}.
              </p>
            </article>
          );
        })}
      </section>

      <footer className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          How this is built
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
          The detector reads every active anti/pro kratom bill&apos;s title, summary, and full
          version-snapshot text. Curated editorial signatures (regex patterns + verbatim
          signature phrases per cluster) classify bills into clusters. A bill can belong to
          multiple clusters when its language spans tactics (e.g. KCPA scaffolding + synthetic
          carve-out). Cluster summaries + suspected origin are editorial judgments based on
          observed industry patterns; specific lobbyist attribution requires the per-bill
          sponsor donor profile (click any bill row for that).
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          v1: pattern-based. Future: bill-text embedding similarity for fuzzy-match clustering,
          cross-state sponsor donor-overlap scoring, automatic lobbyist-attribution via
          legislator_committees × federal_lobbying join.
        </p>
      </footer>
    </div>
  );
}
