import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Bill tracker" };

const RELEVANCE: Record<string, { label: string; cls: string }> = {
  pro: { label: "Pro-kratom", cls: "bg-emerald-950/40 text-emerald-300" },
  anti: { label: "Anti-kratom", cls: "bg-red-950/40 text-red-300" },
  neutral: { label: "Neutral", cls: "bg-zinc-900 text-zinc-400" },
  unknown: { label: "Pending review", cls: "bg-zinc-900 text-zinc-500" },
};

export default async function BillsPage() {
  const supabase = await createClient();
  const { data: bills } = await supabase
    .from("bills")
    .select("id, state, bill_number, title, status, kratom_relevance, last_action, last_action_at, source_url")
    .eq("active", true)
    .order("last_action_at", { ascending: false, nullsFirst: false });

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Bill tracker</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every kratom and 7-OH bill across all 50 states + Congress. Synced from
          LegiScan, attributed under{" "}
          <a
            href="https://legiscan.com"
            className="text-emerald-400 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            LegiScan
          </a>{" "}
          (CC BY 4.0).
        </p>
      </header>

      {!bills || bills.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950/40">
          {bills.map((b) => {
            const tag = RELEVANCE[b.kratom_relevance ?? "unknown"] ?? RELEVANCE.unknown;
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300">
                  {b.state} · {b.bill_number}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${tag.cls}`}>
                  {tag.label}
                </span>
                <h3 className="flex-1 text-sm font-medium">{b.title || "(untitled)"}</h3>
                {b.status && <span className="text-xs text-zinc-500">{b.status}</span>}
                {b.source_url && (
                  <a
                    href={b.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    Source ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center">
      <h2 className="text-lg font-semibold">No bills indexed yet.</h2>
      <p className="mt-2 text-sm text-zinc-400">
        We&apos;re waiting on LegiScan API approval. Once it&apos;s in, every kratom and
        7-OH bill across all 50 states + Congress will populate here, with daily syncs.
      </p>
    </div>
  );
}
