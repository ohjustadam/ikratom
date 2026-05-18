import Link from "next/link";
import {
  KRATOM_INDUSTRY_ACTORS,
  FACTION_META,
  ROLE_LABEL,
  type ActorFaction,
} from "@/lib/kratom-industry-actors";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Industry actors — kratom policy intel",
  description: "The structural map of kratom-industry political actors: lobbyists, lobbying firms, industry orgs, kratom companies, and the regulators who've publicly taken positions.",
  robots: { index: false }, // research data, not SEO
};

type SP = Promise<{ faction?: string }>;

/**
 * /intel/actors — hardcoded industry-actor registry.
 *
 * Editorial research data from src/lib/kratom-industry-actors.ts.
 * Every entry cites public-record evidence URLs (Tampa Bay Times,
 * LDA filings, ProPublica Nonprofit Explorer, company press releases).
 *
 * The "Art of War" view of WHO the players are. Federal lobbying
 * dollars (PR #247 at /intel/lobbying) are the WHAT; this page is
 * the WHO behind those dollars.
 */
export default async function ActorsPage({ searchParams }: { searchParams?: SP }) {
  const sp = searchParams ? await searchParams : {};
  const factionFilter = sp.faction as ActorFaction | undefined;

  const visible = factionFilter
    ? KRATOM_INDUSTRY_ACTORS.filter((a) => a.faction === factionFilter)
    : KRATOM_INDUSTRY_ACTORS;

  // 990 finances for orgs we track in nonprofit_990_filings. Defensive
  // so pre-migration deploys silently skip the section.
  type FilingRow = {
    ein: string; org_name: string; tax_year: number;
    total_revenue: number | null; total_expenses: number | null;
    officer_compensation: number | null;
    total_assets_eoy: number | null;
    source_url: string | null; pdf_url: string | null;
  };
  const latestByEin = new Map<string, FilingRow>();
  try {
    const sb = await createClient();
    const { data } = await sb
      .from("nonprofit_990_filings")
      .select("ein, org_name, tax_year, total_revenue, total_expenses, officer_compensation, total_assets_eoy, source_url, pdf_url")
      .order("tax_year", { ascending: false });
    for (const r of (data ?? []) as FilingRow[]) {
      if (!latestByEin.has(r.ein)) latestByEin.set(r.ein, r);
    }
  } catch { /* table not yet migrated */ }
  const fmt$ = (n: number | null) => n == null ? "—" : `$${n.toLocaleString()}`;

  const factionCounts: Record<string, number> = {};
  for (const a of KRATOM_INDUSTRY_ACTORS) {
    factionCounts[a.faction] = (factionCounts[a.faction] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">← Intel hub</Link>
      </div>
      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Industry actor registry
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Who's pulling the kratom-policy strings
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Hardcoded editorial research — every named actor cites public-record evidence. Updated when a new lobbying filing or investigation surfaces a name we don't have. Pair this with{" "}
          <Link href="/intel/lobbying" className="text-emerald-400 hover:underline">/intel/lobbying</Link>{" "}
          (the dollar-flow data) and{" "}
          <Link href="/legislators" className="text-emerald-400 hover:underline">/legislators</Link>{" "}
          (the targets) for the full operations picture.
        </p>
      </header>

      {/* 990 finances — surfaces topline revenue/expenses/officer
          comp for the orgs we track in nonprofit_990_filings. The
          501(c)(4) "dark money" gap means we don't know donors, but
          we DO know how much money flowed through and how much went
          to officers. Source: ProPublica Nonprofit Explorer. */}
      {latestByEin.size > 0 && (
        <section className="mb-8 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            💰 Latest Form 990 finances (IRS-filed)
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Most recent tax year filed per org. Source: ProPublica Nonprofit Explorer (free public API). 501(c)(4)s aren&apos;t required to disclose donors but DO disclose total revenue, expenses, and key-employee compensation.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-1 text-left">Org</th>
                  <th className="py-1 text-right">Tax year</th>
                  <th className="py-1 text-right">Revenue</th>
                  <th className="py-1 text-right">Expenses</th>
                  <th className="py-1 text-right">Officer comp</th>
                  <th className="py-1 text-right">Assets EOY</th>
                  <th className="py-1 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {[...latestByEin.values()].map((r) => (
                  <tr key={r.ein} className="border-b border-zinc-900">
                    <td className="py-1 text-zinc-200">{r.org_name}</td>
                    <td className="py-1 text-right font-mono text-zinc-400">{r.tax_year}</td>
                    <td className="py-1 text-right font-mono">{fmt$(r.total_revenue)}</td>
                    <td className="py-1 text-right font-mono">{fmt$(r.total_expenses)}</td>
                    <td className="py-1 text-right font-mono">{fmt$(r.officer_compensation)}</td>
                    <td className="py-1 text-right font-mono">{fmt$(r.total_assets_eoy)}</td>
                    <td className="py-1 text-right">
                      {r.source_url && (
                        <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                          ProPublica ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Faction filter pills */}
      <nav className="mb-6 flex flex-wrap gap-2 text-xs">
        <Link
          href="/intel/actors"
          className={`rounded px-3 py-1.5 ${!factionFilter ? "bg-emerald-600 text-zinc-950 font-semibold" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
        >
          All ({KRATOM_INDUSTRY_ACTORS.length})
        </Link>
        {(Object.keys(FACTION_META) as ActorFaction[]).map((f) => {
          const meta = FACTION_META[f];
          const count = factionCounts[f] ?? 0;
          if (count === 0) return null;
          const active = factionFilter === f;
          return (
            <Link
              key={f}
              href={`/intel/actors?faction=${f}`}
              className={`rounded px-3 py-1.5 ${active ? meta.tone + " font-semibold" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
            >
              {meta.emoji} {meta.label} ({count})
            </Link>
          );
        })}
      </nav>

      {/* Faction explainer when filtered */}
      {factionFilter && FACTION_META[factionFilter] && (
        <section className={`mb-6 rounded-lg border p-4 text-sm ${FACTION_META[factionFilter].tone} bg-opacity-20`}>
          <p className="font-semibold">{FACTION_META[factionFilter].emoji} {FACTION_META[factionFilter].label}</p>
          <p className="mt-1 opacity-90">{FACTION_META[factionFilter].summary}</p>
        </section>
      )}

      {/* Actor cards */}
      <section className="space-y-4">
        {visible.map((a) => {
          const factionMeta = FACTION_META[a.faction];
          return (
            <article
              key={a.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5"
              id={a.id}
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h2 className="text-lg font-bold text-zinc-100">{a.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${factionMeta.tone}`}>
                  {factionMeta.emoji} {factionMeta.label}
                </span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                  {ROLE_LABEL[a.role]}
                </span>
                {a.state && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {a.state}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-zinc-200">{a.summary}</p>

              {a.former_government_role && (
                <p className="mt-2 rounded border border-amber-700/40 bg-amber-950/15 px-3 py-2 text-xs text-amber-300">
                  <span className="font-semibold">🔄 Revolving door:</span> {a.former_government_role}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {a.lobbying_firm && (
                  <div className="text-zinc-400">
                    <span className="text-zinc-500">Firm:</span>{" "}
                    <span className="text-zinc-200">{a.lobbying_firm}</span>
                  </div>
                )}
                {a.affiliations.length > 0 && (
                  <div className="text-zinc-400">
                    <span className="text-zinc-500">Affiliations:</span>{" "}
                    {a.affiliations.join(" · ")}
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                {a.evidence_urls.map((url, i) => {
                  let host: string;
                  try { host = new URL(url).hostname.replace(/^www\./, ""); }
                  catch { host = url.slice(0, 30); }
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border border-zinc-800 px-2 py-1 text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
                    >
                      📎 {host} ↗
                    </a>
                  );
                })}
                <span className="ml-auto text-zinc-600">
                  last verified {a.last_verified}
                </span>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="mt-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-xs text-zinc-500">
        <p className="mb-2 font-semibold text-zinc-300">Editorial standards</p>
        <ul className="space-y-1">
          <li>· Every actor cites at least one public-record evidence URL.</li>
          <li>· No alleged-but-unverified connections — only published investigations, federal filings, official records.</li>
          <li>· Allegations are clearly flagged as alleged when included (e.g. Botanic Tonics funding GKC).</li>
          <li>· Update mechanism: add a new entry in <code className="font-mono">src/lib/kratom-industry-actors.ts</code> when a new lobbying filing or investigation surfaces a name we don't have. Each entry is a git-tracked code change with full history.</li>
        </ul>
      </footer>
    </div>
  );
}
