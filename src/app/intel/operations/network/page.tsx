import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KRATOM_INDUSTRY_ACTORS, FACTION_META } from "@/lib/kratom-industry-actors";

export const metadata = {
  title: "Operations network map — kratom-policy coordination graph",
  description: "The full network behind kratom-policy operations: multi-cluster legislators, repeat lobbyists, cross-cluster bills, industry actors, and state coordination indices.",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/**
 * /intel/operations/network — the network map.
 *
 * Single dashboard surfacing every coordination signal we can compute
 * from the existing data:
 *
 *   1. Multi-cluster sponsors — legislators primary-sponsoring bills in
 *      ≥ 2 operations. The most coordinated individual operators.
 *   2. Cross-cluster bills — single bills matching ≥ 2 cluster patterns.
 *      Hybrid tactics; the legislative-language Frankensteins.
 *   3. Federal lobbyist concentration — kratom-issue LDA filings grouped
 *      by registrant, with client + total disclosed income.
 *   4. State coordination index — states ranked by how many distinct
 *      operations have bills there. Higher = more network exposure.
 *   5. Industry-actor cluster intersections — for each actor in the
 *      hardcoded kratom-industry-actors registry, the clusters where
 *      sponsors have a documented relationship via federal lobbying.
 *
 * Read top-to-bottom for the "who's coordinating with whom" story.
 */
export default async function OperationsNetworkPage() {
  const sb = await createClient();

  // ── Pull everything we need
  const [
    membersRes,
    sponsorsRes,
    legsRes,
    clustersRes,
    ldasRes,
  ] = await Promise.all([
    sb.from("bill_cluster_members")
      .select("cluster_id, bill_id, bill_clusters!inner(slug, name, posture), bills!inner(id, state, bill_number, title, active)")
      .eq("bills.active", true),
    sb.from("bill_sponsors")
      .select("bill_id, legislator_id, classification")
      .eq("classification", "primary"),
    sb.from("legislators")
      .select("id, full_name, state, role, district, party, active")
      .eq("active", true),
    sb.from("bill_clusters").select("id, slug, name, posture, bill_count, state_count"),
    sb.from("lobbying_filings")
      .select("registrant_name, client_name, lobbyists, income, filing_year, dt_posted")
      .eq("is_kratom_relevant", true),
  ]);

  type BillJoined = { id: string; state: string; bill_number: string; title: string | null; active: boolean };
  type ClusterJoined = { slug: string; name: string; posture: string };
  type MemberRow = {
    cluster_id: string;
    bill_id: string;
    bill_clusters: ClusterJoined | ClusterJoined[] | null;
    bills: BillJoined | BillJoined[] | null;
  };
  const normalize = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
  const members = (membersRes.data ?? []) as MemberRow[];

  // billId → set of cluster slugs it belongs to
  const billToClusters = new Map<string, Set<string>>();
  // billId → state
  const billToState = new Map<string, string>();
  // billId → bill row
  const billRowById = new Map<string, BillJoined>();
  for (const m of members) {
    const b = normalize(m.bills);
    const c = normalize(m.bill_clusters);
    if (!b || !c) continue;
    if (!billToClusters.has(b.id)) billToClusters.set(b.id, new Set());
    billToClusters.get(b.id)!.add(c.slug);
    billToState.set(b.id, b.state);
    billRowById.set(b.id, b);
  }

  // ── 1. Cross-cluster bills (bills in ≥ 2 clusters)
  type ClusterMembershipSummary = { slug: string; name: string; posture: string };
  const clusterMeta = new Map<string, ClusterMembershipSummary>();
  for (const m of members) {
    const c = normalize(m.bill_clusters);
    if (c) clusterMeta.set(c.slug, c);
  }
  const crossClusterBills: Array<{ bill: BillJoined; clusters: string[] }> = [];
  for (const [billId, clusterSet] of billToClusters.entries()) {
    if (clusterSet.size >= 2) {
      const b = billRowById.get(billId);
      if (b) crossClusterBills.push({ bill: b, clusters: [...clusterSet] });
    }
  }
  crossClusterBills.sort((a, b) => b.clusters.length - a.clusters.length);

  // ── 2. Multi-cluster sponsors (primary sponsor in bills across ≥ 2 clusters)
  const sponsors = (sponsorsRes.data ?? []) as Array<{ bill_id: string; legislator_id: string | null }>;
  const legToClusters = new Map<string, Set<string>>();
  const legToBills = new Map<string, Set<string>>();
  const legToStates = new Map<string, Set<string>>();
  for (const s of sponsors) {
    if (!s.legislator_id) continue;
    const clusters = billToClusters.get(s.bill_id);
    if (!clusters || clusters.size === 0) continue;
    if (!legToClusters.has(s.legislator_id)) legToClusters.set(s.legislator_id, new Set());
    for (const slug of clusters) legToClusters.get(s.legislator_id)!.add(slug);
    if (!legToBills.has(s.legislator_id)) legToBills.set(s.legislator_id, new Set());
    legToBills.get(s.legislator_id)!.add(s.bill_id);
    const state = billToState.get(s.bill_id);
    if (state) {
      if (!legToStates.has(s.legislator_id)) legToStates.set(s.legislator_id, new Set());
      legToStates.get(s.legislator_id)!.add(state);
    }
  }
  type LegRow = { id: string; full_name: string; state: string; role: string; district: string | null; party: string | null; active: boolean };
  const legById = new Map<string, LegRow>();
  for (const l of (legsRes.data ?? []) as LegRow[]) legById.set(l.id, l);

  type MultiClusterOp = {
    legislator_id: string;
    full_name: string;
    state: string;
    role: string;
    district: string | null;
    party: string | null;
    clusters: string[];
    bill_count: number;
  };
  const multiClusterOps: MultiClusterOp[] = [];
  for (const [legId, clusterSet] of legToClusters.entries()) {
    if (clusterSet.size < 2) continue;
    const leg = legById.get(legId);
    if (!leg) continue;
    multiClusterOps.push({
      legislator_id: legId,
      full_name: leg.full_name,
      state: leg.state,
      role: leg.role,
      district: leg.district,
      party: leg.party,
      clusters: [...clusterSet],
      bill_count: legToBills.get(legId)?.size ?? 0,
    });
  }
  multiClusterOps.sort((a, b) =>
    b.clusters.length - a.clusters.length || b.bill_count - a.bill_count,
  );

  // ── 3. Federal lobbyist concentration
  type LdaRow = { registrant_name: string | null; client_name: string | null; lobbyists: unknown; income: number | null; filing_year: number | null };
  const ldas = (ldasRes.data ?? []) as LdaRow[];
  type LobbyistAgg = { registrant: string; filings: number; clients: Set<string>; income: number };
  const byRegistrant = new Map<string, LobbyistAgg>();
  for (const l of ldas) {
    const reg = l.registrant_name?.trim();
    if (!reg) continue;
    const agg = byRegistrant.get(reg) ?? { registrant: reg, filings: 0, clients: new Set(), income: 0 };
    agg.filings += 1;
    if (l.client_name) agg.clients.add(l.client_name);
    agg.income += Number(l.income) || 0;
    byRegistrant.set(reg, agg);
  }
  const topRegistrants = [...byRegistrant.values()]
    .sort((a, b) => b.filings - a.filings || b.income - a.income)
    .slice(0, 15);

  // ── 4. State coordination index (operations active per state)
  type StateCoordRow = { state: string; cluster_count: number; bill_count: number };
  const stateClusterMap = new Map<string, Set<string>>();
  const stateBillCount = new Map<string, number>();
  for (const m of members) {
    const b = normalize(m.bills);
    const c = normalize(m.bill_clusters);
    if (!b || !c) continue;
    if (!stateClusterMap.has(b.state)) stateClusterMap.set(b.state, new Set());
    stateClusterMap.get(b.state)!.add(c.slug);
    stateBillCount.set(b.state, (stateBillCount.get(b.state) ?? 0) + 1);
  }
  const stateCoord: StateCoordRow[] = [...stateClusterMap.entries()]
    .map(([state, set]) => ({ state, cluster_count: set.size, bill_count: stateBillCount.get(state) ?? 0 }))
    .sort((a, b) => b.cluster_count - a.cluster_count || b.bill_count - a.bill_count);

  // ── 5. Industry-actor counts (faction breakdown)
  const factionCounts: Record<string, number> = {};
  for (const a of KRATOM_INDUSTRY_ACTORS) {
    factionCounts[a.faction] = (factionCounts[a.faction] ?? 0) + 1;
  }

  // Total counts for the header
  const totalLegs = legById.size;
  const cosponsorlessCount = multiClusterOps.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel/operations" className="text-zinc-500 hover:text-emerald-400">
          ← Coordinated operations
        </Link>
      </div>

      <header className="mb-8 mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Operations network map
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          The coordination graph
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Five views of the kratom-policy coordination network: who&apos;s sponsoring across multiple
          operations, which bills span multiple tactics, who&apos;s lobbying federally, which states
          are most-coordinated, and where the industry actors land in the registry.
        </p>
        <p className="mt-2 max-w-3xl text-[11px] text-zinc-500">
          {cosponsorlessCount} multi-cluster operators · {crossClusterBills.length} cross-cluster bills · {topRegistrants.length} federal lobbyist firms · {stateCoord.length} states with operation activity · {totalLegs.toLocaleString()} active legislators in the corpus.
        </p>
      </header>

      {/* 1. Multi-cluster sponsors */}
      <section className="mb-8 rounded-lg border border-red-700/40 bg-red-950/10 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">
          🚨 Multi-cluster operators ({multiClusterOps.length})
        </h2>
        <p className="mt-1 text-[11px] text-zinc-400">
          Legislators primary-sponsoring bills in ≥ 2 operations. The most coordinated individual
          actors in the network. Sorted by cluster count, then bill count.
        </p>
        <ul className="mt-3 space-y-1">
          {multiClusterOps.slice(0, 25).map((op) => (
            <li key={op.legislator_id} className="rounded border border-red-700/30 bg-red-950/10 px-2.5 py-1.5 text-[11px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/legislators/${op.legislator_id}/briefing`} className="font-semibold text-red-100 hover:underline">
                  {op.full_name}
                </Link>
                <span className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-300">
                  {op.role.replace(/_/g, " ")}
                </span>
                <span className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">
                  {op.state}
                </span>
                {op.district && <span className="text-[10px] text-zinc-400">D{op.district}</span>}
                {op.party && <span className="text-[10px] text-zinc-400">{op.party}</span>}
                <span className="ml-auto text-[10px] text-zinc-300">
                  <strong className="font-mono">{op.clusters.length}</strong> clusters · <strong className="font-mono">{op.bill_count}</strong> bills
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {op.clusters.map((slug) => {
                  const meta = clusterMeta.get(slug);
                  if (!meta) return null;
                  const tone =
                    meta.posture === "restrictive" ? "bg-red-900/40 text-red-200" :
                    meta.posture === "protective" ? "bg-emerald-900/40 text-emerald-200" :
                    "bg-amber-900/40 text-amber-200";
                  return (
                    <Link key={slug} href={`/intel/operations/${slug}`} className={`rounded px-1.5 py-0.5 text-[9px] hover:opacity-80 ${tone}`}>
                      {meta.name.split("—")[0].trim().split("(")[0].trim()}
                    </Link>
                  );
                })}
              </div>
            </li>
          ))}
          {multiClusterOps.length > 25 && (
            <li className="pt-1 text-[10px] text-zinc-500">
              + {multiClusterOps.length - 25} more multi-cluster operators not shown.
            </li>
          )}
        </ul>
      </section>

      {/* 2. Cross-cluster bills */}
      <section className="mb-8 rounded-lg border border-violet-700/40 bg-violet-950/15 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-violet-300">
          🔀 Cross-cluster bills ({crossClusterBills.length})
        </h2>
        <p className="mt-1 text-[11px] text-zinc-400">
          Bills matching ≥ 2 cluster patterns. Hybrid tactics — the legislative-language Frankensteins.
          A bill that&apos;s simultaneously KCPA framework AND Synthetic-only carve-out is a different
          beast than a single-pattern bill; reading its signature in both clusters reveals the
          drafter&apos;s actual posture.
        </p>
        <ul className="mt-3 space-y-1">
          {crossClusterBills.slice(0, 20).map((x) => (
            <li key={x.bill.id} className="rounded border border-violet-700/30 bg-violet-950/10 px-2.5 py-1.5 text-[11px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/bills/${x.bill.id}`} className="font-semibold text-violet-100 hover:underline">
                  {x.bill.state} {x.bill.bill_number}
                </Link>
                {x.bill.title && (
                  <span className="text-zinc-400">— {x.bill.title.slice(0, 80)}{x.bill.title.length > 80 ? "…" : ""}</span>
                )}
                <span className="ml-auto font-mono text-[10px] text-zinc-300">
                  {x.clusters.length} clusters
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {x.clusters.map((slug) => {
                  const meta = clusterMeta.get(slug);
                  if (!meta) return null;
                  return (
                    <Link key={slug} href={`/intel/operations/${slug}`} className="rounded bg-zinc-900/60 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:bg-zinc-800">
                      {meta.name.split("—")[0].trim().split("(")[0].trim()}
                    </Link>
                  );
                })}
              </div>
            </li>
          ))}
          {crossClusterBills.length > 20 && (
            <li className="pt-1 text-[10px] text-zinc-500">
              + {crossClusterBills.length - 20} more hybrid-tactic bills not shown.
            </li>
          )}
        </ul>
      </section>

      {/* 3. Federal lobbyist concentration */}
      {topRegistrants.length > 0 && (
        <section className="mb-8 rounded-lg border border-violet-700/40 bg-violet-950/10 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-violet-300">
            📜 Federal lobbyist firms — kratom-issue Senate LDA filings
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Top retained DC firms by kratom-issue federal LDA filing count. Multiple-client
            registrants are coordination hubs.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-1 text-left">Registrant (DC firm)</th>
                  <th className="py-1 text-right">Filings</th>
                  <th className="py-1 text-right">Clients</th>
                  <th className="py-1 text-right">Disclosed income</th>
                </tr>
              </thead>
              <tbody>
                {topRegistrants.map((r) => (
                  <tr key={r.registrant} className="border-b border-zinc-900">
                    <td className="py-1 text-zinc-200">{r.registrant}</td>
                    <td className="py-1 text-right font-mono text-zinc-300">{r.filings}</td>
                    <td className="py-1 text-right font-mono text-zinc-300">{r.clients.size}</td>
                    <td className="py-1 text-right font-mono text-violet-200">
                      {r.income > 0 ? `$${r.income.toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. State coordination index */}
      <section className="mb-8 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
          🗺 State coordination index
        </h2>
        <p className="mt-1 text-[11px] text-zinc-400">
          States ranked by distinct operations active there. Higher = the state is exposed to
          more coordinated tactics simultaneously.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stateCoord.slice(0, 24).map((s) => (
            <Link
              key={s.state}
              href={`/states/${s.state}`}
              className="rounded border border-amber-700/30 bg-amber-950/10 px-3 py-1.5 text-[11px] hover:border-amber-500"
            >
              <span className="font-mono font-bold text-amber-200">{s.state}</span>
              <span className="ml-2 text-zinc-300">
                <strong className="font-mono">{s.cluster_count}</strong> clusters · <strong className="font-mono">{s.bill_count}</strong> bills
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 5. Industry-actor registry summary */}
      <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
          🎭 Industry actor registry · {KRATOM_INDUSTRY_ACTORS.length} mapped
        </h2>
        <p className="mt-1 text-[11px] text-zinc-400">
          Hand-curated actors with public-record evidence of kratom-policy participation. Faction
          breakdown:
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {Object.entries(factionCounts).map(([f, n]) => {
            const meta = FACTION_META[f as keyof typeof FACTION_META];
            return (
              <Link
                key={f}
                href={`/intel/actors?faction=${f}`}
                className={`rounded-full border px-2.5 py-1 hover:opacity-90 ${meta?.tone ?? "border-zinc-700 bg-zinc-900 text-zinc-300"}`}
              >
                {meta?.emoji} {meta?.label ?? f} · {n}
              </Link>
            );
          })}
        </div>
      </section>

      <footer className="mt-8 text-[10px] text-zinc-600">
        All views computed live from <code className="rounded bg-zinc-900 px-1">bill_cluster_members</code>,{" "}
        <code className="rounded bg-zinc-900 px-1">bill_sponsors</code>,{" "}
        <code className="rounded bg-zinc-900 px-1">lobbying_filings</code>, and the hardcoded
        actor registry. No new tables; the network is implicit in existing data joins. v1 — future
        layers will add donor-overlap edges, sponsor-lobbyist contact attribution, and visual
        force-directed graph rendering.
      </footer>
    </div>
  );
}
