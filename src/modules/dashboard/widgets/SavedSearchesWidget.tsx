import { listMySavedSearches } from "@/modules/saved-searches/actions";

/**
 * Compact summary of the user's saved searches with their match counts.
 * Hides itself when the user has no saved searches (CTA still visible
 * on the empty state to nudge first-time use).
 */
export async function SavedSearchesWidget() {
  const searches = await listMySavedSearches();

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">monitor</p>
          <h2 className="text-sm font-bold text-zinc-100">Saved searches</h2>
        </div>
        <a
          href="/account/saved-searches"
          className="text-xs text-emerald-400 hover:underline"
        >
          {searches.length === 0 ? "set up →" : "manage →"}
        </a>
      </div>
      {searches.length === 0 ? (
        <p className="px-4 py-3 text-xs text-zinc-500">
          Watch for bills matching your own criteria. We&apos;ll notify you when new
          matches arrive.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-900 text-xs">
          {searches.slice(0, 4).map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-4 py-2">
              <span className={`inline-block h-2 w-2 rounded-full ${s.active ? "bg-emerald-400" : "bg-zinc-700"}`} />
              <span className="min-w-0 flex-1 truncate font-semibold text-zinc-200">{s.name}</span>
              <span className="font-mono text-[10px] text-zinc-500">
                {s.total_matches} match{s.total_matches === 1 ? "" : "es"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
