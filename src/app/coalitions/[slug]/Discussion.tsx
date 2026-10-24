import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { NewThreadForm } from "./NewThreadForm";

/**
 * The group's private discussion board (migration 0273). Members only: RLS
 * returns nothing to anyone else, and the page only renders this for members.
 * Authors show as @username, never a real name.
 */
export async function Discussion({ coalitionId, slug, prefill }: {
  coalitionId: string; slug: string;
  prefill?: { title: string; body: string; pin?: boolean } | null;
}) {
  const sb = await createClient();
  const { data } = await sb
    .from("coalition_threads")
    .select("id, title, author_id, reply_count, last_post_at, pinned_at")
    .eq("coalition_id", coalitionId)
    .is("deleted_at", null)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("last_post_at", { ascending: false })
    .limit(50);
  const threads = (data ?? []) as {
    id: string; title: string; author_id: string; reply_count: number; last_post_at: string; pinned_at: string | null;
  }[];

  const authorIds = [...new Set(threads.map((t) => t.author_id))];
  const handles = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: authorIds });
    for (const p of (profs ?? []) as { id: string; username: string | null; state: string | null }[]) {
      handles.set(p.id, publicHandle(p));
    }
  }

  return (
    <section id="discussion" className="mb-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
        💬 Discussion
      </h2>
      {threads.length === 0 ? (
        <p className="mb-3 text-sm text-zinc-400">
          No discussions yet. Start one: plan a call-in day, share a hearing date, or split up who emails whom.
        </p>
      ) : (
        <ul className="mb-4 space-y-1.5">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/coalitions/${slug}/t/${t.id}`}
                className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border px-3 py-2.5 hover:border-emerald-600 ${
                  t.pinned_at ? "border-amber-600/50 bg-amber-950/10" : "border-zinc-800 bg-zinc-950/40"}`}
              >
                <span className="font-semibold text-zinc-100">
                  {t.pinned_at && <span className="mr-1 text-amber-300" title="Pinned">📌</span>}{t.title}
                </span>
                <span className="text-[11px] text-zinc-500">{handles.get(t.author_id) ?? "@member"}</span>
                <span className="ml-auto text-[11px] text-zinc-500">
                  {t.reply_count} repl{t.reply_count === 1 ? "y" : "ies"} · {new Date(t.last_post_at).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewThreadForm slug={slug} prefill={prefill} />
    </section>
  );
}
