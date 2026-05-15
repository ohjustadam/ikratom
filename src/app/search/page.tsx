import Link from "next/link";
import { searchSite, SITE_SEARCH_KIND_EMOJI, SITE_SEARCH_KIND_LABELS, type SiteSearchKind } from "@/lib/site-search";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const metadata = {
  title: "Search — iKratom",
  description: "Search bills, research, legislators, campaigns, and community threads across iKratom.",
};
export const dynamic = "force-dynamic";

const KINDS: SiteSearchKind[] = ["bill", "paper", "legislator", "campaign", "thread"];

/**
 * /search — site-wide search surface.
 *
 * Origin: owner directive 2026-05-15 — "site wide dynmic search bar with
 * filtering options that can be used on any page... DDoS-safe?"
 *
 * Defensive surface: every request is a normal server-render. The
 * rate-limit gate (30/min/IP) sits in front of the actual DB queries
 * so an abuser can't burn DB CPU just by spamming the URL.
 *
 * No LLM in the path — pure Postgres ilike across the major content
 * tables (bills, research_papers, legislators, campaigns, forum_threads).
 * Per-table cap of 6 results keeps the wire payload small.
 *
 * Replaces the previous bills+threads-only search; broader coverage at
 * a small relevance trade-off (ilike vs tsquery). Our biggest table is
 * 8k rows — ilike-with-indexes is fine at this scale.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; kind?: string; state?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").slice(0, 80);
  const requestedKind = sp.kind && KINDS.includes(sp.kind as SiteSearchKind) ? (sp.kind as SiteSearchKind) : null;
  const stateFilter = sp.state?.toUpperCase().slice(0, 2) || null;

  // Rate-limit gate. We use 30/min for anon — enough for normal users,
  // bounded enough that scraping is unrewarding. Fail-open if DB is
  // unreachable (per checkRateLimit's contract).
  const ip = await getClientIp();
  const allowed = q ? await checkRateLimit(`siteSearch:${ip}`, 30, 60) : true;

  const result = q && allowed
    ? await searchSite(q, {
        kinds: requestedKind ? [requestedKind] : undefined,
        state: stateFilter ?? undefined,
      })
    : { hits: [], tooShort: false };

  // Group by kind for the rendered output
  const grouped = new Map<SiteSearchKind, typeof result.hits>();
  for (const h of result.hits) {
    if (!grouped.has(h.kind)) grouped.set(h.kind, []);
    grouped.get(h.kind)!.push(h);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          🔎 Search
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Search the toolbelt</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Bills, research papers, legislators, campaigns, community threads — all in one place. Free, no tracking, no bot.
        </p>
      </header>

      <form method="GET" className="space-y-3">
        <div>
          <label htmlFor="q" className="sr-only">Search query</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="kratom alkaloids, MS House Bill 1077, Sen. Ron Wyden…"
            autoFocus
            minLength={2}
            maxLength={80}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="kind"
            defaultValue={requestedKind ?? ""}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
          >
            <option value="">All content</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{SITE_SEARCH_KIND_EMOJI[k]} {SITE_SEARCH_KIND_LABELS[k]}s</option>
            ))}
          </select>
          <input
            name="state"
            defaultValue={stateFilter ?? ""}
            placeholder="State (e.g. OK)"
            maxLength={2}
            className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs uppercase text-zinc-300"
          />
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-500"
          >
            Search
          </button>
          {q && (
            <span className="text-[11px] text-zinc-500">
              {result.tooShort ? "Type at least 2 characters." : `${result.hits.length} result${result.hits.length === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      </form>

      {!allowed && (
        <p className="mt-6 rounded-md border border-amber-700/40 bg-amber-950/15 p-3 text-sm text-amber-200">
          Too many searches in a short time. Wait a minute and try again.
        </p>
      )}

      {q && allowed && !result.tooShort && result.hits.length === 0 && (
        <p className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
          No matches for <strong className="text-zinc-300">{q}</strong>. Try fewer words or a broader term.
        </p>
      )}

      {q && allowed && grouped.size > 0 && (
        <div className="mt-6 space-y-6">
          {KINDS.filter((k) => grouped.has(k)).map((k) => {
            const items = grouped.get(k) ?? [];
            return (
              <section key={k}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  {SITE_SEARCH_KIND_EMOJI[k]} {SITE_SEARCH_KIND_LABELS[k]}s · {items.length}
                </h2>
                <ul className="space-y-2">
                  {items.map((h, i) => (
                    <li key={i} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-700/50">
                      <Link href={h.href} className="block">
                        <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                          {h.pills.map((p, j) => (
                            <span key={j} className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">{p}</span>
                          ))}
                        </div>
                        <p className="mt-1 text-sm font-semibold text-zinc-100">{h.title}</p>
                        {h.subtitle && (
                          <p className="text-[11px] text-zinc-400">{h.subtitle}</p>
                        )}
                        {h.snippet && (
                          <p className="mt-1 text-[12px] text-zinc-500 line-clamp-2">{h.snippet}</p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {!q && (
        <section className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
          <p className="font-semibold text-zinc-300">What you can find here</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong className="text-zinc-300">Bills</strong> — search by title, summary, or bill number. Filter by state.</li>
            <li><strong className="text-zinc-300">Research papers</strong> — peer-reviewed kratom + 7-OH evidence library.</li>
            <li><strong className="text-zinc-300">Legislators</strong> — federal and state, by name. Filter by state.</li>
            <li><strong className="text-zinc-300">Campaigns</strong> — active action templates you can fire off in one click.</li>
            <li><strong className="text-zinc-300">Discussions</strong> — public forum threads. Residents-only threads stay hidden.</li>
          </ul>
          <p className="mt-3 text-[11px] text-zinc-500">
            Free, no LLM in the path, no tracking. Rate-limited at 30 queries / minute per IP to keep abuse cheap.
          </p>
        </section>
      )}
    </div>
  );
}
