import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Federal rulemaking tracker — kratom",
  description: "FDA / DEA / HHS / FTC kratom-related rulemaking from Regulations.gov. Open public-comment periods highlighted for direct advocate action.",
};
export const dynamic = "force-dynamic";

/**
 * /intel/rulemaking — federal rulemaking listing.
 *
 * Priority layout:
 *   1. Open-for-comment rows at the top, action-urgent styling +
 *      "Submit comment" CTA buttons. These are the rare-but-critical
 *      moments where an advocate can directly influence a final rule.
 *   2. Recent activity (last 6 months) below for context.
 *   3. Older items grouped by agency.
 *
 * Filter via ?agency=FDA|DEA|HHS|EPA|FTC|...
 */
type SP = Promise<{ agency?: string }>;

type RuleRow = {
  id: string;
  title: string;
  abstract: string | null;
  agency_id: string;
  document_type: string | null;
  posted_date: string | null;
  comment_start_date: string | null;
  comment_end_date: string | null;
  open_for_comment: boolean;
  rg_url: string | null;
  fr_doc_number: string | null;
  comments_count: number;
};

export default async function RulemakingPage({ searchParams }: { searchParams?: SP }) {
  const sb = await createClient();
  const sp = (await searchParams) ?? {};
  const agency = sp.agency?.toUpperCase();

  let q = sb
    .from("federal_rulemaking")
    .select("id, title, abstract, agency_id, document_type, posted_date, comment_start_date, comment_end_date, open_for_comment, rg_url, fr_doc_number, comments_count")
    .order("posted_date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (agency) q = q.eq("agency_id", agency);

  const { data, error } = await q;
  const rows = (data ?? []) as RuleRow[];
  const open = rows.filter(r => r.open_for_comment);
  const recent6mo = rows.filter(r => !r.open_for_comment && r.posted_date && new Date(r.posted_date).getTime() >= Date.now() - 180 * 86_400_000);
  const older = rows.filter(r => !r.open_for_comment && (!r.posted_date || new Date(r.posted_date).getTime() < Date.now() - 180 * 86_400_000));

  // Agency tally for chips
  const byAgency = new Map<string, number>();
  for (const r of rows) byAgency.set(r.agency_id, (byAgency.get(r.agency_id) ?? 0) + 1);
  const topAgencies = [...byAgency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-2 text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">← Intel hub</Link>
      </div>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">🏛 Federal rulemaking</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">FDA / DEA / HHS kratom actions</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Every kratom-mentioning federal rulemaking from <a href="https://www.regulations.gov" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Regulations.gov</a>: Notices of Proposed Rulemaking, Final Rules, agency Notices, NDI submissions, public comments. <strong className="text-zinc-200">Open comment periods are the highest-leverage moment</strong> — comments submitted during them become part of the official record and are read by the rule writers.
        </p>
      </header>

      {/* Open-comment alert */}
      {open.length > 0 ? (
        <section className="mb-8 rounded-lg border-2 border-amber-600/60 bg-amber-950/20 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
            🚨 {open.length} public comment period{open.length === 1 ? "" : "s"} OPEN NOW
          </h2>
          <p className="mt-1 text-xs text-amber-200/80">
            These are the most actionable items on this page. Submit a comment via Regulations.gov before the deadline; each comment is logged in the official record.
          </p>
          <ul className="mt-4 space-y-3">
            {open.map(r => <RuleRowCard key={r.id} r={r} urgent />)}
          </ul>
        </section>
      ) : (
        <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
          No federal public comment periods currently open for kratom rulemaking. When one opens, this page surfaces it loudly at the top + the daily cron pushes it to subscribed users.
        </section>
      )}

      {/* Agency filter chips */}
      {topAgencies.length > 1 && (
        <section className="mb-6 flex flex-wrap gap-2 text-xs">
          <FilterChip href="/intel/rulemaking" label="All agencies" active={!agency} />
          {topAgencies.map(([a, c]) => (
            <FilterChip key={a} href={`/intel/rulemaking?agency=${a}`} label={`${a} (${c})`} active={agency === a} />
          ))}
        </section>
      )}

      {error && (
        <p className="mb-6 rounded border border-red-700/50 bg-red-950/20 p-3 text-xs text-red-300">
          Query error: {error.message}
        </p>
      )}

      {recent6mo.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Recent activity ({recent6mo.length}) — last 6 months
          </h2>
          <ul className="space-y-2">
            {recent6mo.map(r => <RuleRowCard key={r.id} r={r} />)}
          </ul>
        </section>
      )}

      {older.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Earlier activity ({older.length})
          </h2>
          <ul className="space-y-2">
            {older.slice(0, 50).map(r => <RuleRowCard key={r.id} r={r} compact />)}
          </ul>
          {older.length > 50 && (
            <p className="mt-3 text-[10px] text-zinc-600">+ {older.length - 50} older entries not shown.</p>
          )}
        </section>
      )}
    </div>
  );
}

function RuleRowCard({ r, urgent, compact }: { r: RuleRow; urgent?: boolean; compact?: boolean }) {
  const posted = r.posted_date ? new Date(r.posted_date).toLocaleDateString() : "—";
  const closes = r.comment_end_date ? new Date(r.comment_end_date).toLocaleDateString() : null;
  const cls = urgent
    ? "border-amber-600/50 bg-amber-950/30"
    : "border-zinc-800 bg-zinc-950/40";
  return (
    <li className={`rounded border p-3 text-sm ${cls}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{r.agency_id}</span>
        {r.document_type && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">{r.document_type}</span>
        )}
        {urgent && closes && (
          <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            closes {closes}
          </span>
        )}
        <span className="ml-auto text-[10px] text-zinc-500">posted {posted}</span>
      </div>
      <p className={`mt-1 font-semibold text-zinc-100 ${compact ? "text-[13px]" : ""}`}>{r.title}</p>
      {!compact && r.abstract && (
        <p className="mt-1 text-[11px] text-zinc-400">{r.abstract.slice(0, 240)}{r.abstract.length > 240 ? "…" : ""}</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        {r.rg_url && (
          <a href={r.rg_url} target="_blank" rel="noreferrer" className={`hover:underline ${urgent ? "font-bold text-amber-300" : "text-emerald-400"}`}>
            {urgent ? "Submit comment →" : "View on Regulations.gov →"}
          </a>
        )}
        {r.comments_count > 0 && (
          <span className="text-zinc-600">{r.comments_count.toLocaleString()} comment{r.comments_count === 1 ? "" : "s"} so far</span>
        )}
        {r.fr_doc_number && <span className="text-zinc-600">FR {r.fr_doc_number}</span>}
      </div>
    </li>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  const cls = active
    ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-emerald-700";
  return <Link href={href} className={`rounded-full border px-3 py-1 transition ${cls}`}>{label}</Link>;
}
