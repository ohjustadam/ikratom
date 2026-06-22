import { createClient } from "@/lib/supabase/server";

/**
 * Compact list of campaigns the user can act on right now.
 * Every campaign is actionable regardless of the user's state (owner policy
 * 2026-06-22), so this teaser no longer HIDES out-of-state campaigns — it just
 * leads with what's closest to home (the user's state + federal) and fills the
 * rest with the most recent. Capped at 5; the "all →" link shows everything.
 */
export async function ActiveCampaignsWidget({ userState }: { userState: string | null }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, blurb, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return null;

  // Float the user's state + federal campaigns to the top, then fill with the
  // most recent of the rest (already newest-first within each group).
  const top = [...data]
    .sort((a, b) => {
      const aClose = a.state === userState || a.state === null;
      const bClose = b.state === userState || b.state === null;
      if (aClose !== bClose) return aClose ? -1 : 1;
      return 0;
    })
    .slice(0, 5);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">action queue</p>
          <h2 className="text-sm font-bold text-zinc-100">Active campaigns</h2>
        </div>
        <a href="/campaigns" className="text-xs text-emerald-400 hover:underline">
          all →
        </a>
      </div>
      <ul className="divide-y divide-zinc-900">
        {top.map((c) => (
          <li key={c.id}>
            <a
              href={`/campaigns/${c.slug}`}
              className="block px-4 py-2.5 text-sm hover:bg-zinc-950/60"
            >
              <div className="flex items-center gap-2">
                {c.state && (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {c.state}
                  </span>
                )}
                <span className="truncate font-medium text-zinc-100">{c.title}</span>
              </div>
              {c.blurb && (
                <p className="mt-0.5 truncate text-xs text-zinc-500">{c.blurb}</p>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
