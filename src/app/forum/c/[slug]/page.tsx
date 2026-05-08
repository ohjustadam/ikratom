import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCommunityBySlug } from "@/modules/forum/community-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = await getCommunityBySlug(slug);
  return { title: c ? `${c.name} community` : "Community" };
}

/**
 * Topical community thread feed. Mirrors /forum/[state] structurally
 * (thread list with pinned-first, sorted by activity) but filters by
 * forum_threads.community_id instead of state. Inactive communities
 * 404 — RLS on forum_communities.is_active=true handles that.
 */
export default async function CommunityForumPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { slug } = await params;
  const { sort } = await searchParams;

  const community = await getCommunityBySlug(slug);
  if (!community) notFound();

  const supabase = await createClient();
  let q = supabase
    .from("forum_threads")
    .select("id, state, locality, title, body, tag, pinned, locked, post_count, upvote_count, last_activity_at, created_at, author_id")
    .eq("community_id", community.id)
    .neq("moderation_status", "removed")
    .order("pinned", { ascending: false });

  if (sort === "top") {
    q = q.order("upvote_count", { ascending: false });
  } else if (sort === "new") {
    q = q.order("created_at", { ascending: false });
  } else {
    q = q.order("last_activity_at", { ascending: false });
  }

  const { data: threads } = await q.limit(100);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/forum" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Community
      </a>
      <header className="mt-2 mb-6 flex items-start gap-4">
        <span className="text-4xl">{community.icon || "💬"}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold">{community.name}</h1>
          {community.description && (
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">{community.description}</p>
          )}
        </div>
      </header>

      <div className="mb-4 flex items-center gap-3 text-xs">
        <span className="text-zinc-500">Sort:</span>
        <a
          href={`/forum/c/${community.slug}`}
          className={`hover:text-emerald-400 ${!sort ? "text-emerald-400 font-semibold" : "text-zinc-400"}`}
        >
          Hot
        </a>
        <a
          href={`/forum/c/${community.slug}?sort=new`}
          className={`hover:text-emerald-400 ${sort === "new" ? "text-emerald-400 font-semibold" : "text-zinc-400"}`}
        >
          New
        </a>
        <a
          href={`/forum/c/${community.slug}?sort=top`}
          className={`hover:text-emerald-400 ${sort === "top" ? "text-emerald-400 font-semibold" : "text-zinc-400"}`}
        >
          Top
        </a>
      </div>

      {(threads?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center">
          <p className="text-sm text-zinc-400">No threads here yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Be the first — author a thread from your state forum and tag it{" "}
            <span className="font-mono text-zinc-300">{community.name}</span>.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {(threads ?? []).map((t) => (
            <li
              key={t.id}
              className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 hover:border-emerald-500"
            >
              <a href={`/forum/${t.state}/${t.id}`} className="block">
                <div className="flex flex-wrap items-center gap-2">
                  {t.pinned && <span className="text-xs text-amber-400">📌</span>}
                  {t.locked && <span className="text-xs text-zinc-500">🔒</span>}
                  <span className="font-mono text-[10px] uppercase text-zinc-500">{t.state}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                    {t.tag}
                  </span>
                  <span className="font-semibold text-zinc-100">{t.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                  <span>{t.post_count ?? 0} replies</span>
                  <span>↑ {t.upvote_count ?? 0}</span>
                  {t.last_activity_at && (
                    <span>active {new Date(t.last_activity_at).toLocaleDateString()}</span>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
