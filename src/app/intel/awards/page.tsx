import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Federal awards — kratom money flow",
  description: "Federal grants and contracts from USAspending.gov going to kratom-related research and studies. The papers funded here shape future FDA scheduling.",
};
export const dynamic = "force-dynamic";

/**
 * /intel/awards — federal money-flow listing.
 *
 * Two views: by amount (the structural-influence ranking) and by
 * recipient (who's the biggest beneficiary across awards).
 *
 * Filter via ?agency=FDA|NIH|... or ?recipient=<substring>.
 */
type SP = Promise<{ agency?: string; recipient?: string }>;

type AwardRow = {
  id: string;
  amount: number | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  recipient_name: string;
  recipient_state: string | null;
  description: string | null;
  category: string | null;
  award_type_label: string | null;
  start_date: string | null;
  end_date: string | null;
  usa_url: string | null;
  is_research: boolean | null;
};

export default async function FederalAwardsPage({ searchParams }: { searchParams?: SP }) {
  const sb = await createClient();
  const sp = (await searchParams) ?? {};
  const agency = sp.agency;
  const recipientFilter = sp.recipient;

  let q = sb
    .from("federal_awards")
    .select("id, amount, awarding_agency, awarding_sub_agency, recipient_name, recipient_state, description, category, award_type_label, start_date, end_date, usa_url, is_research")
    .order("amount", { ascending: false, nullsFirst: false })
    .limit(200);
  if (agency) q = q.ilike("awarding_sub_agency", `%${agency}%`);
  if (recipientFilter) q = q.ilike("recipient_name", `%${recipientFilter}%`);

  const { data, error } = await q;
  const rows = (data ?? []) as AwardRow[];

  const totalDollars = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  // Aggregate by recipient for the "who's getting paid the most" view
  const byRecipient = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const k = r.recipient_name || "?";
    const cur = byRecipient.get(k) ?? { total: 0, count: 0 };
    cur.total += Number(r.amount) || 0;
    cur.count += 1;
    byRecipient.set(k, cur);
  }
  const topRecipients = [...byRecipient.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8);

  // Agency chips
  const byAgency = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const k = r.awarding_sub_agency || r.awarding_agency || "?";
    const cur = byAgency.get(k) ?? { total: 0, count: 0 };
    cur.total += Number(r.amount) || 0;
    cur.count += 1;
    byAgency.set(k, cur);
  }
  const topAgencies = [...byAgency.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6);

  function fmtDollar(n: number) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return `$${n.toLocaleString()}`;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-2 text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">← Intel hub</Link>
      </div>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">💰 Federal money flow</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Who&apos;s being paid to study kratom</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Every kratom-mentioning federal grant or contract from <a href="https://www.usaspending.gov" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">USAspending.gov</a>. Federal agencies pay private companies and academic institutions to research, evaluate, and study kratom — and the papers that result get cited in future FDA scheduling decisions. <strong className="text-zinc-200">This is the upstream of every regulatory action.</strong>
        </p>
      </header>

      {/* Headline numbers */}
      <section className="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Stat label="Total awards" value={rows.length.toLocaleString()} />
        <Stat label="Total federal $" value={fmtDollar(totalDollars)} />
        <Stat label="Top recipient" value={topRecipients[0]?.[0]?.slice(0, 20) ?? "—"} />
        <Stat label="Top agency" value={topAgencies[0]?.[0]?.slice(0, 24) ?? "—"} />
      </section>

      {/* Top recipients aggregate */}
      {topRecipients.length > 1 && (
        <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Top recipients (rolled up across awards)
          </h2>
          <ul className="space-y-1.5 text-sm">
            {topRecipients.map(([name, { total, count }]) => (
              <li key={name} className="flex items-baseline justify-between gap-3">
                <Link href={`/intel/awards?recipient=${encodeURIComponent(name)}`} className="text-zinc-200 hover:text-emerald-400">
                  {name}
                </Link>
                <span className="text-xs text-zinc-500">
                  {count} award{count === 1 ? "" : "s"} · <span className="font-mono text-zinc-300">{fmtDollar(total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Filter chips */}
      <section className="mb-6 flex flex-wrap gap-2 text-xs">
        <FilterChip href="/intel/awards" label="All agencies" active={!agency && !recipientFilter} />
        {topAgencies.map(([a]) => (
          <FilterChip key={a} href={`/intel/awards?agency=${encodeURIComponent(a)}`} label={a.slice(0, 30)} active={agency === a} />
        ))}
        {recipientFilter && (
          <span className="rounded-full border border-emerald-500 bg-emerald-950/20 px-3 py-1 text-emerald-300">
            recipient: {recipientFilter} <Link href="/intel/awards" className="ml-1 text-zinc-500">×</Link>
          </span>
        )}
      </section>

      {error && (
        <p className="mb-6 rounded border border-red-700/50 bg-red-950/20 p-3 text-xs text-red-300">
          Query error: {error.message}
        </p>
      )}

      {/* Award list */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
          Awards ({rows.length}, ranked by $ amount)
        </h2>
        <ul className="space-y-2">
          {rows.map(r => <AwardCard key={r.id} r={r} fmtDollar={fmtDollar} />)}
        </ul>
        {rows.length === 0 && (
          <p className="rounded border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
            No awards match the current filter. Try clearing it, or refresh via{" "}
            <code className="text-emerald-400">node scripts/sync-usaspending-kratom.mjs</code>.
          </p>
        )}
      </section>
    </div>
  );
}

function AwardCard({ r, fmtDollar }: { r: AwardRow; fmtDollar: (n: number) => string }) {
  const amt = Number(r.amount) || 0;
  return (
    <li className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-base font-bold tabular-nums text-emerald-300">{fmtDollar(amt)}</span>
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">{r.category ?? "?"}</span>
        {r.is_research && <span className="rounded bg-violet-950/40 px-1.5 py-0.5 text-[10px] text-violet-300">research</span>}
        {r.recipient_state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{r.recipient_state}</span>}
        <span className="ml-auto text-[10px] text-zinc-500">
          {r.start_date ? new Date(r.start_date).toLocaleDateString() : "—"}
          {r.end_date && <span> → {new Date(r.end_date).toLocaleDateString()}</span>}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-zinc-300">
        <span className="text-zinc-500">{r.awarding_sub_agency ?? r.awarding_agency ?? "?"} →</span>{" "}
        <Link href={`/intel/awards?recipient=${encodeURIComponent(r.recipient_name)}`} className="font-semibold text-zinc-100 hover:text-emerald-400">
          {r.recipient_name}
        </Link>
      </p>
      {r.description && (
        <p className="mt-1 text-[11px] text-zinc-400">{r.description.slice(0, 280)}{r.description.length > 280 ? "…" : ""}</p>
      )}
      {r.usa_url && (
        <p className="mt-2 text-[10px]">
          <a href={r.usa_url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
            View on USAspending.gov →
          </a>
        </p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</p>
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  const cls = active
    ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-emerald-700";
  return <Link href={href} className={`rounded-full border px-3 py-1 transition ${cls}`}>{label}</Link>;
}
