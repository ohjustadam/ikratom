import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: bill } = await sb
    .from("bills")
    .select("state, bill_number")
    .eq("id", id)
    .maybeSingle();
  if (!bill) return { title: "Bill dossier — not found" };
  const b = bill as { state: string; bill_number: string };
  return {
    title: `${b.state} ${b.bill_number} — printable dossier`,
    description: `One-page printable intel dossier on ${b.state} ${b.bill_number}: sponsors, donors, committee leverage, coordinated-operation memberships, news coverage. Citation-ready.`,
    robots: { index: false },
  };
}

/**
 * /bills/[id]/dossier — printable citation-ready report.
 *
 * Print-first layout: A4-friendly margins, black-on-white, no nav
 * chrome. Compiles the full intel stack for one bill into a single
 * page that journalists, agency staffers, and advocates can print
 * and use directly. Every claim links back to a source.
 *
 * Sections (in order, each headed for skim-reading):
 *   1. Bill identity (state · number · title · status · scope)
 *   2. What it does (summary + last action)
 *   3. Sponsors (with donor industry conflict flags ⚠ + tier chips)
 *   4. Committee deciding (members + tier scores)
 *   5. Coordinated-operation membership (national pattern context)
 *   6. News coverage (deduped, sourced)
 *   7. Source citations (official URLs)
 */
export default async function BillDossierPage({ params }: { params: Params }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: billRaw } = await sb
    .from("bills")
    .select(
      "id, state, bill_number, title, summary, summary_long, status, kratom_relevance, last_action, last_action_at, scope, locality, current_committee_name, official_url, source_url, session_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!billRaw) notFound();
  const bill = billRaw as {
    id: string; state: string; bill_number: string; title: string | null;
    summary: string | null; summary_long: string | null;
    status: string | null; kratom_relevance: string | null;
    last_action: string | null; last_action_at: string | null;
    scope: string | null; locality: string | null;
    current_committee_name: string | null;
    official_url: string | null; source_url: string | null;
    session_id: string | null;
  };

  // Parallel pulls — sponsors, cluster memberships, news, committee leverage
  const [sponsorsRes, clusterMembershipsRes, newsRes, committeeMembersRes] = await Promise.all([
    sb
      .from("bill_sponsors")
      .select("legislator_id, name, classification, party, district, legislators(id, full_name, phone, email)")
      .eq("bill_id", id),
    sb
      .from("bill_cluster_members")
      .select("confidence, match_reason, bill_clusters!inner(slug, name, posture, bill_count, state_count, summary_md)")
      .eq("bill_id", id),
    sb
      .from("news_items")
      .select("id, title, source_name, url, published_at")
      .or(`bill_id.eq.${id}`)
      .eq("active", true)
      .order("published_at", { ascending: false })
      .limit(15),
    bill.current_committee_name
      ? sb
          .from("legislator_committees")
          .select("legislator_id, committee_name, role, is_kratom_relevant, legislators!inner(id, full_name, state, role, district, party, phone, active)")
          .eq("legislators.state", bill.state)
          .eq("legislators.active", true)
          .limit(2000)
      : Promise.resolve({ data: [] }),
  ]);

  type SponsorRow = {
    legislator_id: string | null;
    name: string;
    classification: string;
    party: string | null;
    district: string | null;
    legislators:
      | { id: string; full_name: string; phone: string | null; email: string | null }
      | Array<{ id: string; full_name: string; phone: string | null; email: string | null }>
      | null;
  };
  const sponsors = (sponsorsRes.data ?? []) as SponsorRow[];
  const sponsorLegIds = sponsors
    .map((s) => s.legislator_id)
    .filter((x): x is string => !!x);

  // Donor industries for federal sponsors (if any)
  let donorByLeg = new Map<string, Array<{ industry: string; label?: string; advocate_flag?: boolean; amount: number }>>();
  if (sponsorLegIds.length > 0) {
    const { data: donors } = await sb
      .from("legislator_donors")
      .select("legislator_id, top_industries")
      .in("legislator_id", sponsorLegIds)
      .eq("resolved_status", "matched");
    type D = { legislator_id: string; top_industries: Array<{ industry: string; label?: string; advocate_flag?: boolean; amount: number }> | null };
    for (const d of (donors ?? []) as D[]) {
      if (Array.isArray(d.top_industries)) donorByLeg.set(d.legislator_id, d.top_industries);
    }
  }

  // Committee-leverage rows (subset matching this bill's current committee)
  type CmtRow = {
    legislator_id: string; committee_name: string; role: string;
    is_kratom_relevant: boolean | null;
    legislators: {
      id: string; full_name: string; state: string; role: string;
      district: string | null; party: string | null;
      phone: string | null; active: boolean;
    } | Array<{ id: string; full_name: string; state: string; role: string; district: string | null; party: string | null; phone: string | null; active: boolean }> | null;
  };
  type CommitteeMember = {
    legislator_id: string; full_name: string; role: string;
    district: string | null; party: string | null; phone: string | null;
    committee_role: string;
  };
  let committeeMembers: CommitteeMember[] = [];
  if (bill.current_committee_name) {
    try {
      const { committeesMatch } = await import("@/lib/bill-committee");
      const matched = ((committeeMembersRes.data ?? []) as CmtRow[]).filter((c) =>
        committeesMatch(bill.current_committee_name!, c.committee_name),
      );
      for (const c of matched) {
        const l = Array.isArray(c.legislators) ? c.legislators[0] : c.legislators;
        if (!l) continue;
        committeeMembers.push({
          legislator_id: c.legislator_id,
          full_name: l.full_name,
          role: l.role,
          district: l.district,
          party: l.party,
          phone: l.phone,
          committee_role: c.role,
        });
      }
      committeeMembers.sort((a, b) => {
        if (a.committee_role === "chair" && b.committee_role !== "chair") return -1;
        if (b.committee_role === "chair" && a.committee_role !== "chair") return 1;
        return a.full_name.localeCompare(b.full_name);
      });
    } catch { /* defensive */ }
  }

  type ClusterMembership = {
    confidence: number; match_reason: string | null;
    cluster: { slug: string; name: string; posture: string; bill_count: number; state_count: number; summary_md: string | null };
  };
  const clusterMemberships: ClusterMembership[] = [];
  type CM = {
    confidence: number; match_reason: string | null;
    bill_clusters: { slug: string; name: string; posture: string; bill_count: number; state_count: number; summary_md: string | null }
                 | Array<{ slug: string; name: string; posture: string; bill_count: number; state_count: number; summary_md: string | null }>
                 | null;
  };
  for (const m of (clusterMembershipsRes.data ?? []) as CM[]) {
    const c = Array.isArray(m.bill_clusters) ? m.bill_clusters[0] : m.bill_clusters;
    if (!c) continue;
    clusterMemberships.push({ confidence: m.confidence, match_reason: m.match_reason, cluster: c });
  }
  clusterMemberships.sort((a, b) => b.confidence - a.confidence);

  type NewsRow = { id: string; title: string; source_name: string | null; url: string | null; published_at: string | null };
  const news = (newsRes.data ?? []) as NewsRow[];

  const generatedAt = new Date().toISOString();
  const fullUrl = `https://www.ikratom.org/bills/${bill.id}/dossier`;

  return (
    <>
      {/* Print-friendly CSS overrides for clean A4 output */}
      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: white !important; color: #111 !important; }
          .dossier-no-print { display: none !important; }
          .dossier-page { max-width: 100% !important; padding: 0 !important; color: #111 !important; }
          .dossier-section { break-inside: avoid; }
          .dossier-page a { color: #111 !important; text-decoration: underline; }
          .dossier-page .border { border-color: #ccc !important; }
          .dossier-page .bg-zinc-950, .dossier-page .bg-zinc-900, .dossier-page .bg-amber-950\\/10, .dossier-page .bg-violet-950\\/15, .dossier-page .bg-red-950\\/15, .dossier-page .bg-emerald-950\\/15 { background: transparent !important; }
          .dossier-page .text-zinc-100, .dossier-page .text-zinc-200, .dossier-page .text-zinc-300, .dossier-page .text-zinc-400, .dossier-page .text-zinc-500, .dossier-page .text-zinc-600 { color: #333 !important; }
        }
      `}</style>

      <div className="dossier-page mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 print:max-w-none print:p-0">
        {/* Print-only banner — hidden in print */}
        <div className="dossier-no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-3 text-xs text-emerald-300">
          <span>📄 Printable intel dossier · cite-ready</span>
          <PrintButton />
          <Link href={`/bills/${bill.id}`} className="text-zinc-400 hover:text-emerald-400">
            ← Back to interactive bill page
          </Link>
        </div>

        {/* Header */}
        <header className="mb-5 border-b border-zinc-800 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
            ◉ iKratom intel dossier
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            {bill.state} {bill.bill_number}
          </h1>
          {bill.title && (
            <p className="mt-1 text-sm text-zinc-300">{bill.title}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono uppercase">
              {bill.scope ?? "state"}
            </span>
            {bill.session_id && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono">
                session {bill.session_id}
              </span>
            )}
            {bill.kratom_relevance && (
              <span
                className={`rounded px-1.5 py-0.5 font-mono uppercase ${
                  bill.kratom_relevance === "anti"
                    ? "bg-red-900/50 text-red-200"
                    : bill.kratom_relevance === "pro"
                    ? "bg-emerald-900/50 text-emerald-200"
                    : "bg-zinc-900 text-zinc-300"
                }`}
              >
                {bill.kratom_relevance}-kratom
              </span>
            )}
            {bill.status && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5">
                status: {bill.status}
              </span>
            )}
          </div>
        </header>

        {/* Section 1 — What it does */}
        {(bill.summary_long || bill.summary || bill.last_action) && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              1 · What it does
            </h2>
            {bill.summary_long && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                {bill.summary_long}
              </p>
            )}
            {!bill.summary_long && bill.summary && (
              <p className="text-sm leading-relaxed text-zinc-300">
                {bill.summary}
              </p>
            )}
            {bill.last_action && (
              <p className="mt-2 text-[11px] text-zinc-400">
                <strong className="text-zinc-300">Last action:</strong>{" "}
                {bill.last_action}
                {bill.last_action_at && (
                  <> ({new Date(bill.last_action_at).toLocaleDateString()})</>
                )}
              </p>
            )}
          </section>
        )}

        {/* Section 2 — Sponsors with donor conflict flags */}
        {sponsors.length > 0 && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              2 · Sponsors ({sponsors.length})
            </h2>
            <ul className="space-y-1.5 text-[12px]">
              {sponsors.map((s, i) => {
                const flaggedIndustries = s.legislator_id
                  ? (donorByLeg.get(s.legislator_id) ?? []).filter((ind) => ind.advocate_flag)
                  : [];
                return (
                  <li key={`${s.legislator_id ?? s.name}-${i}`} className="border-b border-zinc-900/50 pb-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {s.classification === "primary" && <span title="Primary sponsor">★</span>}
                      <span className="font-semibold text-zinc-100">{s.name}</span>
                      {s.party && <span className="text-zinc-400">({s.party}{s.district ? ` · D${s.district}` : ""})</span>}
                      <span className="text-[10px] uppercase text-zinc-500">{s.classification}</span>
                    </div>
                    {flaggedIndustries.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-red-300">
                        ⚠ Substance-policy-adjacent industry donations:{" "}
                        {flaggedIndustries.map((ind) => `${ind.label ?? ind.industry} $${ind.amount.toLocaleString()}`).join(" · ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Section 3 — Committee leverage */}
        {committeeMembers.length > 0 && bill.current_committee_name && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              3 · Committee deciding ({bill.current_committee_name})
            </h2>
            <ul className="space-y-1 text-[12px]">
              {committeeMembers.map((m) => (
                <li key={m.legislator_id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{m.full_name}</span>
                  <span className="text-[10px] uppercase text-zinc-500">{m.role.replace(/_/g, " ")}</span>
                  {m.district && <span className="text-[10px] text-zinc-400">D{m.district}</span>}
                  {m.party && <span className="text-[10px] text-zinc-400">{m.party}</span>}
                  {m.committee_role === "chair" && (
                    <span className="text-[10px] font-bold text-amber-300">🪑 CHAIR</span>
                  )}
                  {m.committee_role === "vice_chair" && (
                    <span className="text-[10px] uppercase text-zinc-400">vice chair</span>
                  )}
                  {m.phone && (
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">
                      📞 {m.phone}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Section 4 — Coordinated-operation memberships */}
        {clusterMemberships.length > 0 && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              4 · Part of nationwide pattern{clusterMemberships.length === 1 ? "" : "s"}
            </h2>
            <ul className="space-y-2 text-[12px]">
              {clusterMemberships.map((c) => (
                <li key={c.cluster.slug} className="border-l-2 border-violet-700/40 pl-3">
                  <p className="font-semibold text-zinc-100">
                    🕸 {c.cluster.name}
                    <span className="ml-2 text-[11px] font-normal text-zinc-400">
                      ({c.cluster.bill_count} bills · {c.cluster.state_count} states)
                    </span>
                  </p>
                  {c.cluster.summary_md && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                      {c.cluster.summary_md.slice(0, 300)}{c.cluster.summary_md.length > 300 ? "…" : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Section 5 — News coverage */}
        {news.length > 0 && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              5 · News coverage ({news.length} articles)
            </h2>
            <ul className="space-y-1 text-[11px]">
              {news.slice(0, 12).map((n) => (
                <li key={n.id}>
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:underline">
                      {n.title}
                    </a>
                  ) : (
                    <span className="text-zinc-300">{n.title}</span>
                  )}
                  {(n.source_name || n.published_at) && (
                    <span className="ml-1 text-zinc-500">
                      — {n.source_name}{n.source_name && n.published_at ? ", " : ""}{n.published_at ? new Date(n.published_at).toLocaleDateString() : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Section 6 — Source citations */}
        <section className="dossier-section mb-5">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
            6 · Official sources
          </h2>
          <ul className="space-y-1 text-[11px]">
            {bill.official_url && (
              <li>
                <strong>State-legislature link:</strong>{" "}
                <a href={bill.official_url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:underline break-all">
                  {bill.official_url}
                </a>
              </li>
            )}
            {bill.source_url && bill.source_url !== bill.official_url && (
              <li>
                <strong>Aggregator source:</strong>{" "}
                <a href={bill.source_url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:underline break-all">
                  {bill.source_url}
                </a>
              </li>
            )}
            <li>
              <strong>Live interactive page:</strong>{" "}
              <Link href={`/bills/${bill.id}`} className="text-zinc-300 hover:underline">
                /bills/{bill.id}
              </Link>
            </li>
          </ul>
        </section>

        {/* Footer */}
        <footer className="dossier-section mt-6 border-t border-zinc-800 pt-3 text-[10px] text-zinc-500">
          <p>
            <strong>Dossier generated</strong> {new Date(generatedAt).toISOString().slice(0, 19).replace("T", " ")} UTC ·
            iKratom — the advocate&apos;s toolbelt · nonpartisan
          </p>
          <p className="mt-1">
            <strong>Permalink:</strong> {fullUrl}
          </p>
          <p className="mt-1 italic">
            Compiled from public records: state legislature filings, OpenStates, OpenFEC, STOCK Act
            disclosures (PTRs), legislator press releases, indexed news. Donor industry classifications
            are heuristic; verify each before publication. Cluster memberships are pattern-based; see
            /intel/operations for the detection methodology.
          </p>
        </footer>
      </div>
    </>
  );
}
