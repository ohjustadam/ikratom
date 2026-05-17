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
              className={`rounded-lg border p-5 ${tone}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-xl font-bold">{c.name}</h2>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
                  {POSTURE_LABEL[c.posture] ?? c.posture}
                </span>
                <span className="ml-auto text-[11px] opacity-80">
                  <strong className="font-mono tabular-nums">{c.bill_count}</strong> bills ·{" "}
                  <strong className="font-mono tabular-nums">{c.state_count}</strong> states
                </span>
              </div>

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
