import { createClient } from "@/lib/supabase/server";

/**
 * Compact list of campaigns the user can act on right now.
 * Filters to the user's state + federal-scope campaigns; capped at 5.
 */
export async function ActiveCampaignsWidget({ userState }: { userState: string | null }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, blurb, created_at")
    .eq("active", true)
    .or(userState ? `state.eq.${userState},state.is.null` : `state.is.null`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!data || data.length === 0) return null;

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
        {data.map((c) => (
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
