import { createClient } from "@/lib/supabase/server";

/**
 * Forum threads the member started. Rendered only when get_profile_view said
 * their activity is visible to this viewer. Group threads (community_id set)
 * are left out: listing them would reveal which private groups they are in.
 */
export async function ProfileThreads({ authorId }: { authorId: string }) {
  const supabase = await createClient();
  const { data: threads } = await supabase
    .from("forum_threads")
    .select("id, state, title, tag, post_count, upvote_count, created_at")
    .eq("author_id", authorId)
    .eq("moderation_status", "approved")
    .is("community_id", null)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Threads</h2>
      {threads && threads.length > 0 ? (
        <ul className="space-y-2">
          {threads.map((t) => (
            <li key={t.id}>
              <a
                href={`/forum/${t.state ?? "national"}/${t.id}`}
                className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-700/50"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {t.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{t.state}</span>}
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 capitalize">{t.tag}</span>
                  <span>↑ {t.upvote_count}</span>
                  <span>💬 {t.post_count}</span>
                  <span className="ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
                <h3 className="mt-1 text-base font-semibold leading-tight">{t.title}</h3>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No public threads yet.</p>
      )}
    </section>
  );
}
