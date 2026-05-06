import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Search" };
export const dynamic = "force-dynamic";

type BillHit = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary_ai: string | null;
  kratom_relevance: string | null;
  scope: string | null;
  rank: number;
};
type ThreadHit = {
  id: string;
  state: string | null;
  title: string;
  body: string | null;
  created_at: string;
  rank: number;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const supabase = await createClient();

  let bills: BillHit[] = [];
  let threads: ThreadHit[] = [];
  if (q.length >= 2) {
    // Postgres `websearch_to_tsquery` accepts user-typed phrases gracefully
    // ("kratom ban" OR "schedule II") without us having to sanitize.
    const { data: billRows } = await supabase.rpc("search_bills", { p_q: q });
    const { data: threadRows } = await supabase.rpc("search_threads", { p_q: q });
    bills = (billRows ?? []) as unknown as BillHit[];
    threads = (threadRows ?? []) as unknown as ThreadHit[];
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold sm:text-4xl">Search</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Bills + forum threads, in one place. Postgres full-text — try
          phrases like &quot;7-OH ban&quot; or &quot;consumer protection&quot;.
        </p>
        <form method="GET" className="mt-5 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search bills + forum…"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Search
          </button>
        </form>
      </header>

      {q.length < 2 && (
        <p className="text-sm text-zinc-500">Type at least 2 characters.</p>
      )}

      {q.length >= 2 && bills.length === 0 && threads.length === 0 && (
        <p className="text-sm text-zinc-500">
          No matches. Try a different phrase or browse{" "}
          <a href="/bills" className="text-emerald-400 hover:underline">/bills</a> or{" "}
          <a href="/forum" className="text-emerald-400 hover:underline">/forum</a>.
        </p>
      )}

      {bills.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Bills ({bills.length})
          </h2>
          <ul className="space-y-3">
            {bills.map((b) => (
              <li key={b.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                    {b.state} · {b.bill_number}
                  </span>
                  {b.scope && b.scope !== "state" && (
                    <span className="rounded bg-purple-950/40 px-1.5 py-0.5 capitalize text-purple-300">
                      {b.scope}
                    </span>
                  )}
                  {b.kratom_relevance && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 capitalize text-zinc-400">
                      {b.kratom_relevance}
                    </span>
                  )}
                </div>
                <h3 className="mt-2 text-sm font-medium leading-snug">
                  <a href={`/bills/${b.id}`} className="hover:text-emerald-400">
                    {b.title ?? "(untitled)"}
                  </a>
                </h3>
                {b.summary_ai && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{b.summary_ai}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {threads.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Forum threads ({threads.length})
          </h2>
          <ul className="space-y-3">
            {threads.map((t) => (
              <li key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {t.state && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                      {t.state}
                    </span>
                  )}
                  <span className="text-zinc-500">{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
                <h3 className="mt-2 text-sm font-medium leading-snug">
                  <a href={`/forum/${t.state ?? "national"}/${t.id}`} className="hover:text-emerald-400">
                    {t.title}
                  </a>
                </h3>
                {t.body && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{t.body}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
