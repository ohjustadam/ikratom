import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { getFPStats, listFlaggedFPs } from "@/modules/news/admin-fp";
import { FPActions } from "./FPActions";

export const metadata = { title: "FP review · Intel Health" };
export const dynamic = "force-dynamic";

/**
 * /admin/intel-health/false-positives
 *
 * Admin audit surface for the news false-positive filter. Shows:
 *   - Top-line quality stats (FP rate, weekly trend, Phase 2 coverage)
 *   - Per-source noisiness ranking (which feeds produce the most FPs)
 *   - Paginated list of currently-flagged items with one-click
 *     unflag / deactivate
 *
 * The point of this page is TRUST — owner shouldn't have to take it
 * on faith that the filter is doing the right thing. Every FP shows
 * its excerpt so the call is auditable.
 */
export default async function FalsePositivesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const sp = (await searchParams) ?? {};
  const search = sp.q?.trim() || undefined;
  const page = Math.max(0, parseInt(sp.page ?? "0") || 0);
  const PER_PAGE = 50;

  const [stats, { rows, hasMore }] = await Promise.all([
    getFPStats(),
    listFlaggedFPs({ search, offset: page * PER_PAGE, limit: PER_PAGE }),
  ]);

  const pct = (n: number, d: number) => (d === 0 ? "0" : ((n / d) * 100).toFixed(1));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/intel-health" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Intel Health
      </a>

      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">News false positives</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Items the FP filter has hidden from /pulse + /news. Every flag is
          auditable — see the body excerpt + one-click unflag for any item
          the filter got wrong.
        </p>
      </header>

      {/* Stats band */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active items" value={stats.total} sub="news_items table" />
        <Stat label="Verified kratom" value={stats.passed} sub={`${pct(stats.passed, stats.total)}% of total`} tone="ok" />
        <Stat label="Flagged FP" value={stats.flagged} sub={`+${stats.flaggedThisWeek} this week`} tone="warn" />
        <Stat label="Pending verify" value={stats.pending} sub="not yet processed" tone={stats.pending > 200 ? "warn" : "ok"} />
        <Stat label="Phase 2 resolved" value={stats.resolvedUrlCount} sub={`${pct(stats.resolvedUrlCount, stats.total)}% have publisher URL`} />
        <Stat label="FP rate" value={`${pct(stats.flagged, stats.total)}%`} sub="of active items" />
      </section>

      {/* Per-source noise */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Noisiest sources (FP rate)
        </h2>
        <p className="mb-2 text-xs text-zinc-500">
          Sources that contribute the highest share of FPs. A high rate suggests
          the publisher syndicates kratom widget links onto unrelated articles —
          consider removing them from the Google News query if the rate stays high.
        </p>
        {stats.topNoisySources.length === 0 ? (
          <p className="text-sm text-zinc-500">No data yet.</p>
        ) : (
          <ul className="space-y-1">
            {stats.topNoisySources.map((s) => (
              <li
                key={s.source}
                className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5"
              >
                <span className="font-mono text-sm text-zinc-200 min-w-[300px] truncate" title={s.source}>
                  {s.source}
                </span>
                <span className="text-xs text-zinc-500">{s.flagged} FP / {s.total} total</span>
                <span
                  className={`ml-auto font-mono text-xs ${
                    s.rate > 0.75 ? "text-red-400" : s.rate > 0.5 ? "text-amber-400" : "text-zinc-500"
                  }`}
                >
                  {(s.rate * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Search */}
      <form className="mb-4 flex flex-wrap items-center gap-2" action="">
        <input
          type="search"
          name="q"
          defaultValue={search ?? ""}
          placeholder="Search flagged-item titles…"
          className="flex-1 min-w-[200px] rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm hover:border-emerald-500"
        >
          Search
        </button>
        {search && (
          <a href="?" className="text-xs text-zinc-500 hover:text-emerald-400">
            clear
          </a>
        )}
      </form>

      {/* List */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Flagged items {search ? `· filtered "${search}"` : "· newest first"}
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
            No flagged items {search ? "match this search" : "right now"}.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-[11px] text-zinc-500">
                  <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono">
                    {r.state ?? "?"}
                  </span>
                  <span>{r.source_name ?? "(unknown source)"}</span>
                  {r.published_at && (
                    <span className="text-zinc-600">{r.published_at.slice(0, 10)}</span>
                  )}
                  {r.body_verified_at && (
                    <span className="text-zinc-600">
                      verified {r.body_verified_at.slice(0, 10)}
                    </span>
                  )}
                  <FPActions id={r.id} />
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{r.title}</p>
                {r.body_extract_excerpt && (
                  <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                    {r.body_extract_excerpt.slice(0, 200)}…
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-emerald-400"
                    title="Original (Google News redirect) URL"
                  >
                    google news ↗
                  </a>
                  {r.resolved_url && (
                    <a
                      href={r.resolved_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-emerald-400"
                      title="Resolved publisher URL — what Phase 2 fetched"
                    >
                      publisher ↗
                    </a>
                  )}
                  {r.ai_relevance_score != null && (
                    <span className="text-zinc-600">score {(r.ai_relevance_score * 100).toFixed(0)}%</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        <div className="mt-6 flex items-center justify-between text-xs">
          {page > 0 ? (
            <a
              href={`?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page - 1) }).toString()}`}
              className="text-zinc-400 hover:text-emerald-400"
            >
              ← Previous
            </a>
          ) : <span />}
          <span className="text-zinc-600">page {page + 1}</span>
          {hasMore ? (
            <a
              href={`?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page + 1) }).toString()}`}
              className="text-zinc-400 hover:text-emerald-400"
            >
              Next →
            </a>
          ) : <span />}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const accent =
    tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : "text-zinc-100";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}
