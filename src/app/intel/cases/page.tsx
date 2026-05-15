import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Court litigation tracker — kratom",
  description: "Kratom-related court cases — published opinions and active dockets from CourtListener / Free Law Project. The second battlefield after legislatures.",
};
export const dynamic = "force-dynamic";

/**
 * /intel/cases — court litigation listing.
 *
 * Two priority levels in the rendering:
 *   1. Industry-party (parties_industry=true) — AKA, GKC, Botanic
 *      Tonics named as plaintiff or defendant. The highest-signal
 *      rows. Surface at top, with the case name + court + date.
 *   2. Everything else — published opinions interpreting state
 *      kratom statutes, non-industry dockets. Useful context but
 *      lower priority.
 *
 * Filter via ?state=XX or ?kind=opinion|docket. Cap at 100 rows
 * shown; admins can dig deeper via direct table query.
 */
type SP = Promise<{ state?: string; kind?: string }>;

type CaseRow = {
  id: string;
  case_name: string;
  case_kind: string;
  court_name: string | null;
  state: string | null;
  date_filed: string | null;
  citation: string[] | null;
  docket_number: string | null;
  parties_industry: boolean;
  challenged_law: string | null;
  cl_url: string | null;
  snippet: string | null;
  judge: string | null;
};

export default async function CourtCasesPage({ searchParams }: { searchParams?: SP }) {
  const sb = await createClient();
  const sp = (await searchParams) ?? {};
  const stateFilter = sp.state?.toUpperCase();
  const kindFilter = sp.kind === "opinion" || sp.kind === "docket" ? sp.kind : undefined;

  let q = sb
    .from("court_cases")
    .select("id, case_name, case_kind, court_name, state, date_filed, citation, docket_number, parties_industry, challenged_law, cl_url, snippet, judge")
    .order("date_filed", { ascending: false, nullsFirst: false })
    .limit(150);
  if (stateFilter) q = q.eq("state", stateFilter);
  if (kindFilter) q = q.eq("case_kind", kindFilter);

  const { data, error } = await q;
  const rows = (data ?? []) as CaseRow[];
  const industry = rows.filter(r => r.parties_industry);
  const opinions = rows.filter(r => r.case_kind === "opinion" && !r.parties_industry);
  const dockets = rows.filter(r => r.case_kind === "docket" && !r.parties_industry);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-2 text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">← Intel hub</Link>
      </div>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">⚖ Court litigation</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Kratom in the courts</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          The second battlefield after legislatures. When a state passes a ban, the industry&apos;s next move is the courts.
          Source: <a href="https://www.courtlistener.com" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">CourtListener / Free Law Project</a>.
          Two case kinds tracked: <strong className="text-zinc-200">opinions</strong> (decided cases interpreting kratom statutes) and <strong className="text-zinc-200">RECAP dockets</strong> (active filings).
        </p>
      </header>

      {/* Filter chips */}
      <section className="mb-6 flex flex-wrap gap-2 text-xs">
        <Filter href="/intel/cases" label="All" active={!stateFilter && !kindFilter} />
        <Filter href="/intel/cases?kind=opinion" label="Opinions only" active={kindFilter === "opinion"} />
        <Filter href="/intel/cases?kind=docket" label="Active dockets only" active={kindFilter === "docket"} />
        {stateFilter && (
          <span className="rounded-full border border-emerald-500 bg-emerald-950/20 px-3 py-1 text-emerald-300">
            state: {stateFilter} <Link href="/intel/cases" className="ml-1 text-zinc-500">×</Link>
          </span>
        )}
      </section>

      {error && (
        <p className="mb-6 rounded border border-red-700/50 bg-red-950/20 p-3 text-xs text-red-300">
          Query error: {error.message}
        </p>
      )}

      {industry.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-300">
            🎯 Industry-party cases ({industry.length}) — AKA / GKC / Botanic Tonics as named party
          </h2>
          <p className="mb-3 text-[11px] text-zinc-500">Highest-signal rows. These are direct industry litigation — when AKA sues a state over a ban, or Botanic Tonics sues a former business partner, that&apos;s here.</p>
          <ul className="space-y-2">
            {industry.map(r => <CaseRow key={r.id} c={r} />)}
          </ul>
        </section>
      )}

      {opinions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            📚 Published opinions ({opinions.length})
          </h2>
          <p className="mb-3 text-[11px] text-zinc-500">Decided cases interpreting kratom statutes — usually criminal cases where a court has had to rule on state schedules. Useful for understanding how courts have read existing laws.</p>
          <ul className="space-y-2">
            {opinions.slice(0, 40).map(r => <CaseRow key={r.id} c={r} />)}
          </ul>
        </section>
      )}

      {dockets.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            📋 Active dockets, non-industry ({dockets.length})
          </h2>
          <ul className="space-y-2">
            {dockets.slice(0, 40).map(r => <CaseRow key={r.id} c={r} />)}
          </ul>
        </section>
      )}

      {rows.length === 0 && (
        <p className="mt-10 rounded border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
          No cases match the current filter. Try clearing it or running{" "}
          <code className="text-emerald-400">node scripts/sync-courtlistener-kratom.mjs</code> to refresh.
        </p>
      )}
    </div>
  );
}

function CaseRow({ c }: { c: CaseRow }) {
  const date = c.date_filed ? new Date(c.date_filed).toLocaleDateString() : "—";
  return (
    <li className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">{c.case_kind}</span>
        {c.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{c.state}</span>}
        {c.parties_industry && (
          <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">industry-party</span>
        )}
        {c.challenged_law && (
          <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">challenges {c.challenged_law} law</span>
        )}
        <span className="ml-auto text-[10px] text-zinc-500">{date}</span>
      </div>
      <p className="mt-1 font-semibold text-zinc-100">{c.case_name}</p>
      {c.court_name && (
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {c.court_name}
          {c.docket_number && <span> · docket {c.docket_number}</span>}
          {c.judge && <span> · {c.judge}</span>}
        </p>
      )}
      {Array.isArray(c.citation) && c.citation.length > 0 && (
        <p className="mt-0.5 text-[11px] text-zinc-500">{c.citation.join(", ")}</p>
      )}
      {c.snippet && (
        <p className="mt-2 text-[11px] italic text-zinc-400">{c.snippet.slice(0, 220)}{c.snippet.length > 220 ? "…" : ""}</p>
      )}
      {c.cl_url && (
        <p className="mt-2 text-[10px]">
          <a href={`https://www.courtlistener.com${c.cl_url}`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
            View on CourtListener →
          </a>
        </p>
      )}
    </li>
  );
}

function Filter({ href, label, active }: { href: string; label: string; active: boolean }) {
  const cls = active
    ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-emerald-700";
  return (
    <Link href={href} className={`rounded-full border px-3 py-1 transition ${cls}`}>
      {label}
    </Link>
  );
}
