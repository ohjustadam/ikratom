import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Federal lobbying intel — kratom",
  description: "Public Senate LDA filings disclosing kratom-related federal lobbying. AKA, GKC, Botanical Education Alliance + their retained DC firms.",
};
export const dynamic = "force-dynamic";

type Filing = {
  id: string;
  filing_uuid: string;
  filing_type: string | null;
  filing_type_display: string | null;
  filing_year: number | null;
  filing_period_display: string | null;
  filing_document_url: string | null;
  dt_posted: string | null;
  income: number | null;
  expenses: number | null;
  registrant_name: string | null;
  registrant_city: string | null;
  registrant_state: string | null;
  client_name: string | null;
  issue_codes: string[] | null;
  issue_descriptions: string[] | null;
  government_entities: string[] | null;
  lobbyists: Array<{ first_name?: string; middle_name?: string; last_name?: string; covered_position?: string | null }> | null;
};

type SP = Promise<{ year?: string; client?: string; registrant?: string }>;

const ISSUE_LABEL: Record<string, string> = {
  CSP: "Consumer Issues / Safety / Products",
  HCR: "Health Issues",
  GOV: "Government Issues",
  FOO: "Food Industry",
  PHA: "Pharmacy",
  TAX: "Taxation",
  MED: "Medicare / Medicaid",
  TRA: "Trade",
  AGR: "Agriculture",
  LBR: "Labor / Workforce",
  CDT: "Communications / Broadcasting / Radio / TV",
};

/**
 * /intel/lobbying — federal lobbying intel hub.
 *
 * Lists every kratom-mentioning Senate LDA filing in our database.
 * Sourced from lda.senate.gov/api/v1/filings/ via scripts/sync-lda-kratom.mjs.
 *
 * This is the "Art of War" view: the kratom industry's federal
 * political influence flows through 501(c)(4) lobbying disclosures,
 * not FEC contributions. ~276 filings disclose ~$10M+ in cumulative
 * lobbying spend by AKA, GKC, Botanical Education Alliance, et al.
 * Public record. Now searchable in one place.
 *
 * Filters via URL params:
 *   ?year=2024
 *   ?client=american+kratom
 *   ?registrant=upstream
 */
export default async function LobbyingIntelPage({ searchParams }: { searchParams?: SP }) {
  const sp = searchParams ? await searchParams : {};
  const yearFilter = sp.year ? parseInt(sp.year, 10) : null;
  const clientFilter = sp.client?.toLowerCase() ?? null;
  const registrantFilter = sp.registrant?.toLowerCase() ?? null;

  const sb = await createClient();

  let q = sb.from("lobbying_filings")
    .select("*")
    .order("filing_year", { ascending: false, nullsFirst: false })
    .order("dt_posted", { ascending: false, nullsFirst: false });

  if (yearFilter) q = q.eq("filing_year", yearFilter);
  if (clientFilter) q = q.ilike("client_name", `%${clientFilter}%`);
  if (registrantFilter) q = q.ilike("registrant_name", `%${registrantFilter}%`);

  const { data: filings } = await q.limit(500);
  const rows = (filings ?? []) as unknown as Filing[];

  // Aggregate stats for the header banner
  const totalIncome = rows.reduce((sum, f) => sum + (f.income ?? 0), 0);
  const totalExpenses = rows.reduce((sum, f) => sum + (f.expenses ?? 0), 0);
  const totalSpend = totalIncome + totalExpenses;
  const distinctClients = new Set(rows.map((f) => f.client_name).filter(Boolean)).size;
  const distinctRegistrants = new Set(rows.map((f) => f.registrant_name).filter(Boolean)).size;
  const allYears = Array.from(new Set(rows.map((f) => f.filing_year).filter((y): y is number => y != null))).sort((a, b) => b - a);

  // Top clients by filing count
  const clientCounts: Record<string, { count: number; spend: number }> = {};
  for (const f of rows) {
    const c = f.client_name ?? "(unknown)";
    if (!clientCounts[c]) clientCounts[c] = { count: 0, spend: 0 };
    clientCounts[c].count++;
    clientCounts[c].spend += (f.income ?? 0) + (f.expenses ?? 0);
  }
  const topClients = Object.entries(clientCounts)
    .sort((a, b) => b[1].spend - a[1].spend || b[1].count - a[1].count)
    .slice(0, 10);

  // Top registrant firms
  const registrantCounts: Record<string, number> = {};
  for (const f of rows) {
    const r = f.registrant_name ?? "(unknown)";
    registrantCounts[r] = (registrantCounts[r] ?? 0) + 1;
  }
  const topRegistrants = Object.entries(registrantCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Lobbyist frequency
  const lobbyistCounts: Record<string, number> = {};
  for (const f of rows) {
    for (const l of f.lobbyists ?? []) {
      const name = [l.first_name, l.middle_name, l.last_name].filter(Boolean).join(" ");
      if (!name) continue;
      lobbyistCounts[name] = (lobbyistCounts[name] ?? 0) + 1;
    }
  }
  const topLobbyists = Object.entries(lobbyistCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Govt entities contacted
  const entityCounts: Record<string, number> = {};
  for (const f of rows) {
    for (const e of f.government_entities ?? []) {
      entityCounts[e] = (entityCounts[e] ?? 0) + 1;
    }
  }
  const topEntities = Object.entries(entityCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const hasFilter = !!yearFilter || !!clientFilter || !!registrantFilter;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Federal lobbying intel
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Kratom lobbying — every public filing
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          The kratom industry&apos;s federal political influence flows here, not through FEC campaign contributions. Every Senate LDA filing mentioning kratom is indexed from <a href="https://lda.senate.gov/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">lda.senate.gov</a> — public record, no auth required. AKA, Global Kratom Coalition, Botanical Education Alliance, and their retained DC firms (Upstream Consulting, Valente &amp; Associates, The Raben Group) all show up here.
        </p>
      </header>

      {/* Headline stats */}
      <section className="mb-8 grid gap-3 sm:grid-cols-4">
        <Stat label="Filings indexed" value={rows.length.toLocaleString()} sub={hasFilter ? "filtered" : "all kratom-relevant"} />
        <Stat label="Distinct clients" value={distinctClients.toString()} sub={`${distinctRegistrants} registrant firms`} />
        <Stat label="Disclosed spend" value={totalSpend > 0 ? `$${(totalSpend / 1000).toFixed(0)}K` : "—"} sub="income + expenses (LDA-reported)" tone="amber" />
        <Stat label="Year span" value={allYears.length > 0 ? `${allYears[allYears.length - 1]}–${allYears[0]}` : "—"} sub="filing years covered" />
      </section>

      {/* Filters */}
      <section className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs">
        <div className="mb-2 font-semibold uppercase tracking-wider text-zinc-400">Filter</div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/intel/lobbying"
            className={`rounded px-2 py-1 ${!hasFilter ? "bg-emerald-600 text-zinc-950" : "border border-zinc-700 hover:border-emerald-500"}`}
          >
            All
          </Link>
          {allYears.slice(0, 8).map((y) => (
            <Link
              key={y}
              href={`/intel/lobbying?year=${y}`}
              className={`rounded px-2 py-1 ${yearFilter === y ? "bg-emerald-600 text-zinc-950" : "border border-zinc-700 hover:border-emerald-500"}`}
            >
              {y}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="text-zinc-500">Clients:</span>
          <Link href="/intel/lobbying?client=american+kratom" className="text-emerald-400 hover:underline">AKA</Link>
          <Link href="/intel/lobbying?client=global+kratom" className="text-emerald-400 hover:underline">GKC</Link>
          <Link href="/intel/lobbying?client=botanical+education" className="text-emerald-400 hover:underline">BEA</Link>
        </div>
      </section>

      {/* Top players */}
      {!hasFilter && (
        <section className="mb-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">Top clients</h3>
            <ul className="space-y-1 text-[11px]">
              {topClients.map(([client, agg]) => (
                <li key={client} className="flex justify-between gap-2">
                  <span className="truncate text-zinc-200" title={client}>{client.slice(0, 40)}</span>
                  <span className="shrink-0 text-zinc-400">{agg.count}×{agg.spend > 0 ? ` · $${(agg.spend / 1000).toFixed(0)}K` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">Top registrant firms</h3>
            <ul className="space-y-1 text-[11px]">
              {topRegistrants.map(([reg, count]) => (
                <li key={reg} className="flex justify-between gap-2">
                  <span className="truncate text-zinc-200" title={reg}>{reg.slice(0, 40)}</span>
                  <span className="shrink-0 text-zinc-400">{count}×</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">Top lobbyists</h3>
            <ul className="space-y-1 text-[11px]">
              {topLobbyists.map(([name, count]) => (
                <li key={name} className="flex justify-between gap-2">
                  <span className="truncate text-zinc-200">{name}</span>
                  <span className="shrink-0 text-zinc-400">{count} filings</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Government entities contacted */}
      {!hasFilter && topEntities.length > 0 && (
        <section className="mb-8 rounded-lg border border-amber-700/30 bg-amber-950/10 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            ⚡ Who they lobby (government entities named)
          </h3>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {topEntities.map(([entity, count]) => (
              <span key={entity} className="rounded border border-amber-700/30 bg-amber-950/15 px-2 py-1">
                {entity} · <span className="text-amber-300">{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Filings list */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
          All filings ({rows.length})
        </h2>
        <ul className="space-y-3">
          {rows.map((f) => (
            <li key={f.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono uppercase">{f.filing_type_display ?? f.filing_type}</span>
                <span className="font-mono text-zinc-300">{f.filing_year} · {f.filing_period_display}</span>
                {(f.income ?? f.expenses) ? (
                  <span className="rounded bg-amber-950/40 px-1.5 py-0.5 font-mono text-amber-300">
                    ${((f.income ?? f.expenses ?? 0)).toLocaleString()}
                  </span>
                ) : null}
                {f.filing_document_url && (
                  <a
                    href={f.filing_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[10px] text-emerald-400 hover:underline"
                  >
                    LDA doc ↗
                  </a>
                )}
              </div>
              <p className="mt-2 text-sm">
                <span className="font-semibold text-zinc-100">{f.registrant_name ?? "(unknown firm)"}</span>
                <span className="text-zinc-500"> {f.registrant_city ? `· ${f.registrant_city}, ${f.registrant_state}` : ""}</span>
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Lobbying for: <span className="font-semibold text-zinc-200">{f.client_name ?? "(unknown)"}</span>
              </p>
              {f.lobbyists && f.lobbyists.length > 0 && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Lobbyists: {f.lobbyists.slice(0, 4).map((l) => [l.first_name, l.last_name].filter(Boolean).join(" ")).filter(Boolean).join(", ")}
                  {f.lobbyists.length > 4 && ` +${f.lobbyists.length - 4} more`}
                </p>
              )}
              {f.government_entities && f.government_entities.length > 0 && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Contacted: {f.government_entities.slice(0, 6).join(", ")}
                </p>
              )}
              {f.issue_codes && f.issue_codes.length > 0 && (
                <p className="mt-1 text-[11px]">
                  {f.issue_codes.map((c) => (
                    <span key={c} className="mr-1 rounded bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-400" title={ISSUE_LABEL[c] ?? c}>
                      {c}
                    </span>
                  ))}
                </p>
              )}
              {f.issue_descriptions && f.issue_descriptions.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-emerald-400">
                    Specific issues lobbied ({f.issue_descriptions.length}) ▾
                  </summary>
                  <ul className="mt-1 space-y-1 text-[11px] text-zinc-300">
                    {f.issue_descriptions.map((d, i) => (
                      <li key={i} className="rounded border border-zinc-900 bg-zinc-950 p-1.5">{d.slice(0, 600)}{d.length > 600 ? "…" : ""}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {rows.length === 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center">
          <p className="text-3xl">📜</p>
          <p className="mt-2 text-sm text-zinc-300">No filings match this filter.</p>
          {hasFilter && (
            <Link href="/intel/lobbying" className="mt-2 inline-block text-xs text-emerald-400 hover:underline">
              Clear filter →
            </Link>
          )}
          {!hasFilter && (
            <p className="mt-1 text-xs text-zinc-500">
              The lobbying_filings table is empty — run <code className="font-mono">npm run sync:lda</code> to backfill.
            </p>
          )}
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-800 pt-4 text-[10px] text-zinc-500">
        Data source: <a href="https://lda.senate.gov/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">U.S. Senate LDA database</a>.
        Public record, no auth required. Synced daily.
        Disclosed spend reflects what registrants self-report on LDA forms LD-1 / LD-2 — actual industry political spend likely exceeds these numbers via 501(c)(4) dark money (AKA, GKC) which doesn&apos;t require donor disclosure.
      </footer>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "amber" }) {
  const cls = tone === "amber"
    ? "border-amber-700/40 bg-amber-950/15 text-amber-300"
    : "border-zinc-800 bg-zinc-950/40 text-zinc-300";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[10px] opacity-70">{sub}</p>
    </div>
  );
}
