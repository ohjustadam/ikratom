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
      .select("cluster_id, bill_id, bill_clusters!inner(slug, name, posture), bills!inner(id, state, bill_number, title, active, last_action_at, created_at)")
      .eq("bills.active", true),
    // Pull BOTH primary + cosponsor so we can build the co-sponsorship
    // graph (sec 2b). Primary-only filtering happens client-side where
    // it's needed.
    sb.from("bill_sponsors")
      .select("bill_id, legislator_id, classification"),
    sb.from("legislators")
      .select("id, full_name, state, role, district, party, active")
      .eq("active", true),
    sb.from("bill_clusters").select("id, slug, name, posture, bill_count, state_count"),
    sb.from("lobbying_filings")
      .select("registrant_name, client_name, lobbyists, income, filing_year, dt_posted")
      .eq("is_kratom_relevant", true),
  ]);

  type BillJoined = { id: string; state: string; bill_number: string; title: string | null; active: boolean; last_action_at: string | null; created_at: string };
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
  const sponsorsAll = (sponsorsRes.data ?? []) as Array<{ bill_id: string; legislator_id: string | null; classification: string | null }>;
  const sponsors = sponsorsAll.filter((s) => s.classification === "primary");
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

  // ── 2b. Co-sponsorship pair graph — pairs of legislators who appear
  // together on multiple cluster-membered bills (in any role: primary
  // or cosponsor). Reveals the tight inner circles — legislators who
  // back each other's coordinated bills. The actual relationship graph
  // beneath the multi-cluster operator list.
  const billToLegs = new Map<string, Set<string>>();
  for (const s of sponsorsAll) {
    if (!s.legislator_id) continue;
    if (!billToClusters.has(s.bill_id)) continue; // only cluster-membered bills
    if (!billToLegs.has(s.bill_id)) billToLegs.set(s.bill_id, new Set());
    billToLegs.get(s.bill_id)!.add(s.legislator_id);
  }
  const pairCount = new Map<string, { count: number; bills: Set<string>; clusters: Set<string> }>();
  // Outlier bills with absurd sponsor counts (omnibus-style with 50+
  // cosponsors) would generate thousands of weakly-coupled pairs each
  // and dilute the signal. Cap each bill's pair-emission at MAX_LEGS
  // (the most-actively-coordinated set tends to be the primary +
  // first-cosponsors anyway). 25 covers every realistic kratom bill;
  // anything beyond is omnibus signaling rather than coordination.
  const MAX_LEGS_PER_BILL = 25;
  for (const [billId, legSet] of billToLegs.entries()) {
    if (legSet.size < 2) continue;
    if (legSet.size > MAX_LEGS_PER_BILL) continue;
    const legs = [...legSet].sort();
    const billClusters = billToClusters.get(billId) ?? new Set<string>();
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const key = `${legs[i]}::${legs[j]}`;
        const agg = pairCount.get(key) ?? { count: 0, bills: new Set<string>(), clusters: new Set<string>() };
        agg.count += 1;
        agg.bills.add(billId);
        for (const c of billClusters) agg.clusters.add(c);
        pairCount.set(key, agg);
      }
    }
  }
  type CoSponsorPair = {
    a: LegRow;
    b: LegRow;
    bills: number;
    clusters: number;
  };
  const topCoPairs: CoSponsorPair[] = [...pairCount.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([key, v]) => {
      const [aId, bId] = key.split("::");
      const a = legById.get(aId);
      const b = legById.get(bId);
      if (!a || !b) return null;
      return { a, b, bills: v.bills.size, clusters: v.clusters.size };
    })
    .filter((x): x is CoSponsorPair => x !== null)
    .sort((x, y) => y.bills - x.bills || y.clusters - x.clusters)
    .slice(0, 15);

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

  // ── 3b. Named lobbyists — individuals (not firms). LDA `lobbyists`
  // is a JSON array of {first_name, last_name, covered_position}.
  // Aggregating by full name surfaces the actual humans who turn
  // up across multiple kratom filings + their former-gov backgrounds
  // (the "revolving door" pattern).
  type LobbyistPerson = {
    name: string;
    filings: number;
    clients: Set<string>;
    registrants: Set<string>;
    covered_positions: Set<string>;
  };
  const byPerson = new Map<string, LobbyistPerson>();
  for (const l of ldas) {
    const arr = Array.isArray(l.lobbyists) ? l.lobbyists : [];
    type LobbyistEntry = { first_name?: string | null; last_name?: string | null; covered_position?: string | null };
    for (const lob of arr as LobbyistEntry[]) {
      const first = lob?.first_name?.trim();
      const last = lob?.last_name?.trim();
      if (!last) continue;
      const fullName = first ? `${first} ${last}`.toUpperCase() : last.toUpperCase();
      const agg = byPerson.get(fullName) ?? {
        name: fullName, filings: 0, clients: new Set(),
        registrants: new Set(), covered_positions: new Set(),
      };
      agg.filings += 1;
      if (l.client_name) agg.clients.add(l.client_name);
      if (l.registrant_name) agg.registrants.add(l.registrant_name);
      if (lob.covered_position) agg.covered_positions.add(lob.covered_position);
      byPerson.set(fullName, agg);
    }
  }
  const topPeople = [...byPerson.values()]
    .filter((p) => p.filings >= 2)
    .sort((a, b) => b.filings - a.filings)
    .slice(0, 20);

  // ── 3c. Cluster co-occurrence matrix — pairs of clusters that
  // share the most bills. Reveals which tactical combinations get
  // bundled together (e.g. KCPA scaffolding + Synthetic-only carve-out
  // = the advocate-friendly hybrid; Schedule I + Age-21 = full
  // criminalization-plus-restriction).
  const clusterPairCount = new Map<string, number>();
  for (const clusterSet of billToClusters.values()) {
    const slugs = [...clusterSet];
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const key = [slugs[i], slugs[j]].sort().join("||");
        clusterPairCount.set(key, (clusterPairCount.get(key) ?? 0) + 1);
      }
    }
  }
  type ClusterPair = { a: ClusterMembershipSummary; b: ClusterMembershipSummary; count: number };
  const topPairs: ClusterPair[] = [...clusterPairCount.entries()]
    .map(([key, count]) => {
      const [aSlug, bSlug] = key.split("||");
      const a = clusterMeta.get(aSlug);
      const b = clusterMeta.get(bSlug);
      if (!a || !b) return null;
      return { a, b, count };
    })
    .filter((x): x is ClusterPair => x !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── 3d. Operation propagation timeline — for each cluster, the
  // chronological order states first introduced bills matching its
  // pattern. Reveals the model-legislation travel route: which state
  // seeded the operation and which states copied next. Uses each
  // bill's earliest available timestamp (last_action_at, falling
  // back to created_at) as a proxy for introduction date.
  type PropagationStep = { state: string; date: string; bill_id: string; bill_number: string };
  type ClusterPropagation = { slug: string; name: string; steps: PropagationStep[] };
  const clusterFirstSeen = new Map<string, Map<string, { date: string; bill_id: string; bill_number: string }>>();
  for (const m of members) {
    const b = normalize(m.bills);
    const c = normalize(m.bill_clusters);
    if (!b || !c) continue;
    const dateStr = b.last_action_at ?? b.created_at?.slice(0, 10);
    if (!dateStr) continue;
    if (!clusterFirstSeen.has(c.slug)) clusterFirstSeen.set(c.slug, new Map());
    const stateMap = clusterFirstSeen.get(c.slug)!;
    const prev = stateMap.get(b.state);
    if (!prev || dateStr < prev.date) {
      stateMap.set(b.state, { date: dateStr, bill_id: b.id, bill_number: b.bill_number });
    }
  }
  const propagations: ClusterPropagation[] = [...clusterFirstSeen.entries()]
    .map(([slug, stateMap]) => {
      const meta = clusterMeta.get(slug);
      if (!meta) return null;
      const steps: PropagationStep[] = [...stateMap.entries()]
        .map(([state, v]) => ({ state, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return { slug, name: meta.name, steps };
    })
    .filter((x): x is ClusterPropagation => x !== null && x.steps.length >= 3)
    .sort((a, b) => b.steps.length - a.steps.length);

  // ── 3e. Recently-active operations — clusters with bills last
  // touched in the past 180 days. Distinguishes "alive operation"
  // from "historical pattern in corpus".
  const HORIZON_DAYS = 180;
  const horizon = new Date(Date.now() - HORIZON_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  type RecentOp = { slug: string; name: string; bills_recent: number; states_recent: Set<string>; latest_date: string };
  const recentByCluster = new Map<string, RecentOp>();
  for (const m of members) {
    const b = normalize(m.bills);
    const c = normalize(m.bill_clusters);
    if (!b || !c) continue;
    const dateStr = b.last_action_at ?? b.created_at?.slice(0, 10);
    if (!dateStr || dateStr < horizon) continue;
    const agg = recentByCluster.get(c.slug) ?? {
      slug: c.slug, name: c.name, bills_recent: 0, states_recent: new Set<string>(), latest_date: "",
    };
    agg.bills_recent += 1;
    agg.states_recent.add(b.state);
    if (dateStr > agg.latest_date) agg.latest_date = dateStr;
    recentByCluster.set(c.slug, agg);
  }
  const recentOps = [...recentByCluster.values()].sort((a, b) => b.bills_recent - a.bills_recent);

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
          {cosponsorlessCount} multi-cluster operators · {topCoPairs.length} co-sponsorship pairs · {crossClusterBills.length} cross-cluster bills · {topRegistrants.length} federal lobbyist firms · {propagations.length} operations w/ traced propagation · {recentOps.length} active in last {HORIZON_DAYS}d · {stateCoord.length} states with operation activity.
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

      {/* 2b. Co-sponsorship pair graph */}
      {topCoPairs.length > 0 && (
        <section className="mb-8 rounded-lg border border-orange-700/40 bg-orange-950/10 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-orange-300">
            🤝 Co-sponsorship pairs · inner-circle relationships ({topCoPairs.length})
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Legislator pairs appearing together (in any role) on ≥ 2 cluster-membered bills. The
            actual relationship graph beneath the operator list — these are the working
            partnerships moving coordinated kratom policy.
          </p>
          <ul className="mt-3 space-y-1">
            {topCoPairs.map((p, i) => (
              <li key={i} className="rounded border border-orange-700/30 bg-orange-950/5 px-2.5 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/legislators/${p.a.id}/briefing`} className="font-semibold text-orange-100 hover:underline">
                    {p.a.full_name}
                  </Link>
                  <span className="font-mono text-[9px] text-zinc-500">({p.a.state})</span>
                  <span className="text-zinc-500">+</span>
                  <Link href={`/legislators/${p.b.id}/briefing`} className="font-semibold text-orange-100 hover:underline">
                    {p.b.full_name}
                  </Link>
                  <span className="font-mono text-[9px] text-zinc-500">({p.b.state})</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-300">
                    <strong>{p.bills}</strong> shared bill{p.bills === 1 ? "" : "s"} · <strong>{p.clusters}</strong> cluster{p.clusters === 1 ? "" : "s"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {/* 3b. Named lobbyists */}
      {topPeople.length > 0 && (
        <section className="mb-8 rounded-lg border border-violet-500/40 bg-violet-950/10 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-violet-300">
            👤 Named lobbyists · individuals on multiple kratom filings
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            People (not firms) appearing on ≥ 2 kratom-issue federal LDA filings.
            Covered-position field surfaces former-government roles — the &quot;revolving door&quot; signal.
          </p>
          <ul className="mt-3 space-y-1">
            {topPeople.map((p) => (
              <li key={p.name} className="rounded border border-violet-700/30 bg-violet-950/10 px-2.5 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-violet-100">{p.name}</span>
                  <span className="text-[10px] text-zinc-400">
                    {p.filings} filing{p.filings === 1 ? "" : "s"} · {p.clients.size} client{p.clients.size === 1 ? "" : "s"} · {p.registrants.size} firm{p.registrants.size === 1 ? "" : "s"}
                  </span>
                </div>
                {p.covered_positions.size > 0 && (
                  <p className="mt-0.5 text-[10px] italic text-amber-300">
                    🔄 Revolving door: {[...p.covered_positions].slice(0, 2).join(" · ")}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  Clients: {[...p.clients].slice(0, 4).join(" · ")}{p.clients.size > 4 ? ` + ${p.clients.size - 4} more` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3c. Cluster co-occurrence */}
      {topPairs.length > 0 && (
        <section className="mb-8 rounded-lg border border-violet-700/30 bg-violet-950/10 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-violet-300">
            🔗 Cluster co-occurrence · tactical bundling
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Which operations get bundled into the same bills. High counts mean drafters
            routinely combine these tactics — useful for reading intent (e.g. KCPA scaffolding +
            Synthetic-only carve-out = advocate-aligned hybrid; Schedule I + Age-21 =
            criminalization plus age restriction layered together).
          </p>
          <ul className="mt-3 space-y-1 text-[11px]">
            {topPairs.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded border border-violet-700/20 bg-violet-950/5 px-2 py-1">
                <Link href={`/intel/operations/${p.a.slug}`} className="font-semibold text-violet-100 hover:underline">
                  {p.a.name.split("—")[0].trim().split("(")[0].trim()}
                </Link>
                <span className="text-zinc-500">×</span>
                <Link href={`/intel/operations/${p.b.slug}`} className="font-semibold text-violet-100 hover:underline">
                  {p.b.name.split("—")[0].trim().split("(")[0].trim()}
                </Link>
                <span className="ml-auto font-mono text-zinc-300">
                  <strong>{p.count}</strong> shared bill{p.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3d. Operation propagation timeline */}
      {propagations.length > 0 && (
        <section className="mb-8 rounded-lg border border-sky-700/30 bg-sky-950/10 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-sky-300">
            🛰 Operation propagation · state-by-state travel
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            For each operation, the chronological order states first introduced a matching bill.
            First state ≈ seed; later states copied the model. Date shown is the earliest action
            recorded for the bill in that state — a proxy for when the operation arrived.
          </p>
          <ul className="mt-3 space-y-3 text-[11px]">
            {propagations.slice(0, 8).map((p) => {
              const head = p.steps.slice(0, 8);
              const remainder = p.steps.length - head.length;
              return (
                <li key={p.slug} className="rounded border border-sky-700/20 bg-sky-950/5 px-3 py-2">
                  <Link href={`/intel/operations/${p.slug}`} className="font-semibold text-sky-100 hover:underline">
                    {p.name.split("—")[0].trim()}
                  </Link>
                  <span className="ml-2 text-zinc-500">{p.steps.length} states total</span>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10px]">
                    {head.map((s, i) => (
                      <span key={s.state} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-zinc-600">→</span>}
                        <span className="rounded bg-sky-900/40 px-1.5 py-0.5 text-sky-100">
                          {s.state}
                        </span>
                        <span className="text-zinc-500">{s.date.slice(0, 7)}</span>
                      </span>
                    ))}
                    {remainder > 0 && (
                      <span className="text-zinc-500">+ {remainder} more</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 3e. Recently-active operations */}
      {recentOps.length > 0 && (
        <section className="mb-8 rounded-lg border border-rose-700/30 bg-rose-950/10 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-rose-300">
            ⚡ Active operations · last {HORIZON_DAYS} days
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Operations with bill activity in the past six months. Live threat surface — these are
            running campaigns, not historical patterns in the corpus.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {recentOps.map((op) => (
              <li key={op.slug} className="rounded border border-rose-700/20 bg-rose-950/5 px-3 py-2 text-[11px]">
                <Link href={`/intel/operations/${op.slug}`} className="font-semibold text-rose-100 hover:underline">
                  {op.name.split("—")[0].trim()}
                </Link>
                <div className="mt-1 flex items-center gap-3 text-zinc-300">
                  <span><strong className="font-mono">{op.bills_recent}</strong> bills</span>
                  <span><strong className="font-mono">{op.states_recent.size}</strong> states</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-500">
                    latest {op.latest_date.slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
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
        actor registry. No new tables; the network is implicit in existing data joins. Cross-page
        bridges: operations-involved chip on{" "}
        <Link href="/intel/threat-matrix" className="text-zinc-400 hover:text-emerald-400">threat matrix</Link>,
        cluster involvement on the{" "}
        <Link href="/intel/donations" className="text-zinc-400 hover:text-emerald-400">donor leaderboard</Link>,
        federal LDA per faction on the{" "}
        <Link href="/intel/actors" className="text-zinc-400 hover:text-emerald-400">actor registry</Link>.
      </footer>
    </div>
  );
}
