import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/bills/[id]/dossier/PrintButton";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data } = await sb
    .from("bill_clusters")
    .select("name, bill_count, state_count")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return { title: "Operation dossier — not found" };
  const c = data as { name: string; bill_count: number; state_count: number };
  return {
    title: `${c.name} — printable dossier`,
    description: `Printable citation-ready dossier on the ${c.name} kratom-policy operation: ${c.bill_count} bills across ${c.state_count} states.`,
    robots: { index: false },
  };
}

/**
 * /intel/operations/[slug]/dossier — printable per-cluster report.
 *
 * Same shape as /bills/[id]/dossier but scoped to one coordinated
 * operation. The journalist/agency package: drop this URL into a
 * citation and the recipient has a self-contained report on the
 * entire pattern.
 */
export default async function ClusterDossierPage({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();

  const { data: cluster } = await sb
    .from("bill_clusters")
    .select("id, slug, name, posture, summary_md, suspected_origin, signature_phrases, bill_count, state_count, earliest_introduced, latest_introduced")
    .eq("slug", slug)
    .maybeSingle();
  if (!cluster) notFound();
  const c = cluster as {
    id: string; slug: string; name: string; posture: string;
    summary_md: string | null; suspected_origin: string | null;
    signature_phrases: string[] | null;
    bill_count: number; state_count: number;
    earliest_introduced: string | null; latest_introduced: string | null;
  };

  // Bills in cluster
  const { data: membersRaw } = await sb
    .from("bill_cluster_members")
    .select("bills!inner(id, state, bill_number, title, status, last_action_at, active)")
    .eq("cluster_id", c.id)
    .eq("bills.active", true);

  type BillJoined = {
    id: string; state: string; bill_number: string; title: string | null;
    status: string | null; last_action_at: string | null; active: boolean;
  };
  type MemberJoined = { bills: BillJoined | BillJoined[] | null };
  function normalizeBill(b: BillJoined | BillJoined[] | null): BillJoined | null {
    if (Array.isArray(b)) return b[0] ?? null;
    return b;
  }
  const bills: BillJoined[] = [];
  for (const m of (membersRaw ?? []) as MemberJoined[]) {
    const b = normalizeBill(m.bills);
    if (b) bills.push(b);
  }
  const billsByState = new Map<string, BillJoined[]>();
  for (const b of bills) {
    if (!billsByState.has(b.state)) billsByState.set(b.state, []);
    billsByState.get(b.state)!.push(b);
  }
  const states = [...billsByState.entries()].sort((a, b) => b[1].length - a[1].length);

  // Donor industry aggregation (federal sponsors only — state donor
  // data not yet populated)
  const billIds = bills.map((b) => b.id);
  let donorRows: Array<{ industry: string; label: string; advocate_flag: boolean; amount: number; recipients: number }> = [];
  let federalSponsorCount = 0;
  if (billIds.length > 0) {
    const { data: sps } = await sb
      .from("bill_sponsors")
      .select("legislator_id, classification")
      .in("bill_id", billIds)
      .eq("classification", "primary");
    const distinctIds = [...new Set((sps ?? []).map((s) => s.legislator_id).filter((x): x is string => !!x))];
    if (distinctIds.length > 0) {
      const { data: donors } = await sb
        .from("legislator_donors")
        .select("legislator_id, top_industries")
        .in("legislator_id", distinctIds)
        .eq("resolved_status", "matched");
      const industryMap = new Map<string, { amount: number; label: string; advocate_flag: boolean; recipients: number }>();
      type D = { legislator_id: string; top_industries: Array<{ industry: string; label?: string; advocate_flag?: boolean; amount: number }> | null };
      for (const d of (donors ?? []) as D[]) {
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
      donorRows = [...industryMap.entries()]
        .map(([id, x]) => ({ industry: id, ...x }))
        .filter((r) => r.amount >= 1_000)
        .sort((a, b) => b.amount - a.amount);
    }
  }
  const flaggedTotal = donorRows.filter((r) => r.advocate_flag).reduce((s, r) => s + r.amount, 0);

  const generatedAt = new Date().toISOString();
  const permalink = `https://www.ikratom.org/intel/operations/${c.slug}/dossier`;

  return (
    <>
      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: white !important; color: #111 !important; }
          .dossier-no-print { display: none !important; }
          .dossier-page { max-width: 100% !important; padding: 0 !important; color: #111 !important; }
          .dossier-section { break-inside: avoid; }
          .dossier-page a { color: #111 !important; text-decoration: underline; }
          .dossier-page .border { border-color: #ccc !important; }
        }
      `}</style>

      <div className="dossier-page mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 print:max-w-none print:p-0">
        <div className="dossier-no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-3 text-xs text-emerald-300">
          <span>📄 Coordinated-operation dossier · citation-ready</span>
          <PrintButton />
          <Link href={`/intel/operations/${c.slug}`} className="text-zinc-400 hover:text-emerald-400">
            ← Back to interactive view
          </Link>
        </div>

        <header className="mb-5 border-b border-zinc-800 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
            ◉ iKratom coordinated-operation dossier
          </p>
          <h1 className="mt-1 text-2xl font-bold">{c.name}</h1>
          <p className="mt-1 text-sm text-zinc-300">
            <strong>{c.bill_count}</strong> bills · <strong>{c.state_count}</strong> states · posture: {c.posture}
            {c.earliest_introduced && c.latest_introduced && (
              <> · active range: {c.earliest_introduced} → {c.latest_introduced}</>
            )}
          </p>
        </header>

        {c.summary_md && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              1 · What this operation does
            </h2>
            <p className="text-sm leading-relaxed text-zinc-300">{c.summary_md}</p>
          </section>
        )}

        {c.suspected_origin && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              2 · Suspected origin
            </h2>
            <p className="text-sm leading-relaxed text-zinc-300">{c.suspected_origin}</p>
          </section>
        )}

        {Array.isArray(c.signature_phrases) && c.signature_phrases.length > 0 && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              3 · Signature phrases · verbatim recurring text
            </h2>
            <ul className="space-y-0.5 text-[12px]">
              {c.signature_phrases.map((p) => (
                <li key={p}>
                  <code className="font-mono text-zinc-200">&quot;{p}&quot;</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {donorRows.length > 0 && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              4 · Industry money behind this operation
            </h2>
            <p className="text-[11px] text-zinc-400">
              Across {federalSponsorCount} federal sponsor{federalSponsorCount === 1 ? "" : "s"} with matched OpenFEC data.
              {flaggedTotal > 0 && (
                <> Total from substance-policy-adjacent industries (⚠): ${flaggedTotal.toLocaleString()}.</>
              )}
              {" "}State-legislator donor data not yet wired (50-state effort).
            </p>
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {donorRows.slice(0, 15).map((r) => (
                <li key={r.industry} className="flex flex-wrap items-baseline gap-x-2">
                  {r.advocate_flag && <span className="font-bold">⚠</span>}
                  <span className={r.advocate_flag ? "font-semibold" : ""}>{r.label}</span>
                  <span className="text-[10px] text-zinc-500">
                    ({r.recipients} sponsor{r.recipients === 1 ? "" : "s"})
                  </span>
                  <span className="ml-auto font-mono tabular-nums">${r.amount.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {states.length > 0 && (
          <section className="dossier-section mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
              5 · All bills in this operation
            </h2>
            {states.map(([state, stateBills]) => (
              <div key={state} className="mb-3">
                <p className="text-[11px] font-mono font-bold uppercase text-zinc-200">
                  {state} ({stateBills.length})
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {stateBills.map((b) => (
                    <li key={b.id}>
                      <Link href={`/bills/${b.id}`} className="text-zinc-300 hover:underline">
                        <span className="font-mono">{b.bill_number}</span>
                        {b.title && <> — {b.title.slice(0, 80)}{b.title.length > 80 ? "…" : ""}</>}
                      </Link>
                      {b.status && <span className="ml-1 text-[10px] text-zinc-500">[{b.status}]</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <footer className="dossier-section mt-6 border-t border-zinc-800 pt-3 text-[10px] text-zinc-500">
          <p>
            <strong>Dossier generated</strong> {new Date(generatedAt).toISOString().slice(0, 19).replace("T", " ")} UTC ·
            iKratom — the advocate&apos;s toolbelt · nonpartisan
          </p>
          <p className="mt-1">
            <strong>Permalink:</strong> {permalink}
          </p>
          <p className="mt-1 italic">
            Compiled from public records: state legislature filings, OpenStates,
            OpenFEC, legislator stance drafts. Cluster detection methodology:
            pattern-based regex on bill text + verbatim signature-phrase matching
            (see /intel/operations for the full how-this-is-built explainer).
          </p>
        </footer>
      </div>
    </>
  );
}
