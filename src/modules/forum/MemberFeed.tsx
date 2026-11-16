import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { memberFeedItems, type FeedItem } from "./member-feed";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Named = { id: string; username: string | null; state: string | null };

async function handles(supabase: Supabase, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((id): id is string => !!id))];
  if (want.length === 0) return new Map();
  const { data } = await supabase.rpc("get_public_profiles", { p_ids: want });
  return new Map(((data ?? []) as Named[]).map((p) => [p.id, publicHandle(p)]));
}

async function forumItems(supabase: Supabase, limit: number): Promise<FeedItem[]> {
  const [{ data: threads }, { data: posts }] = await Promise.all([
    supabase
      .from("forum_threads")
      .select("id, state, title, body, author_id, created_at, system_generated")
      .eq("moderation_status", "approved")
      .eq("system_generated", false)
      .not("author_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("forum_posts")
      .select("thread_id, author_id, created_at")
      .eq("moderation_status", "approved")
      .is("deleted_at", null)
      .not("author_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const threadIds = [...new Set((posts ?? []).map((p) => p.thread_id as string))];
  const { data: parentRows } = threadIds.length
    ? await supabase
        .from("forum_threads")
        .select("id, title, state")
        .in("id", threadIds)
        .eq("moderation_status", "approved")
    : { data: [] as { id: string; title: string; state: string | null }[] };

  return memberFeedItems({
    threads: threads ?? [],
    posts: posts ?? [],
    parents: new Map((parentRows ?? []).map((t) => [t.id, t])),
    names: await handles(supabase, [
      ...(threads ?? []).map((t) => t.author_id),
      ...(posts ?? []).map((p) => p.author_id),
    ]),
    limit,
  });
}

/** Posts in the groups this member belongs to, and only those: an admin can read them all. */
async function groupItems(supabase: Supabase, userId: string, limit: number): Promise<FeedItem[]> {
  const { data: memberships } = await supabase
    .from("coalition_members")
    .select("coalition_id")
    .eq("user_id", userId);
  const groupIds = (memberships ?? []).map((m) => m.coalition_id as string);
  if (groupIds.length === 0) return [];

  const [{ data: groups }, { data: threads }, { data: posts }] = await Promise.all([
    supabase.from("coalitions").select("id, slug, name").in("id", groupIds),
    supabase
      .from("coalition_threads")
      .select("id, coalition_id, author_id, title, created_at")
      .in("coalition_id", groupIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("coalition_posts")
      .select("thread_id, coalition_id, author_id, created_at")
      .in("coalition_id", groupIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const byId = new Map((groups ?? []).map((g) => [g.id as string, g]));
  const threadIds = [...new Set((posts ?? []).map((p) => p.thread_id as string))];
  const { data: parents } = threadIds.length
    ? await supabase.from("coalition_threads").select("id, title").in("id", threadIds).is("deleted_at", null)
    : { data: [] as { id: string; title: string }[] };
  const titles = new Map((parents ?? []).map((t) => [t.id as string, t.title as string]));
  const names = await handles(supabase, [
    ...(threads ?? []).map((t) => t.author_id),
    ...(posts ?? []).map((p) => p.author_id),
  ]);

  const items: FeedItem[] = [];
  for (const t of threads ?? []) {
    const group = byId.get(t.coalition_id);
    if (!group) continue;
    items.push({
      kind: "thread",
      place: group.name,
      title: t.title,
      href: `/coalitions/${group.slug}/t/${t.id}`,
      author: t.author_id ? names.get(t.author_id) ?? null : null,
      at: t.created_at,
    });
  }
  for (const p of posts ?? []) {
    const group = byId.get(p.coalition_id);
    const title = titles.get(p.thread_id);
    if (!group || !title) continue;
    items.push({
      kind: "reply",
      place: group.name,
      title,
      href: `/coalitions/${group.slug}/t/${p.thread_id}`,
      author: p.author_id ? names.get(p.author_id) ?? null : null,
      at: p.created_at,
    });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** The top of the Community page: what people wrote, in the forum and in your groups. */
export async function MemberFeed({ userId, limit = 8 }: { userId: string | null; limit?: number }) {
  const supabase = await createClient();
  const [forum, groups] = await Promise.all([
    forumItems(supabase, limit),
    userId ? groupItems(supabase, userId, limit) : Promise.resolve([]),
  ]);

  return (
    <div className={`grid gap-4 ${groups.length > 0 ? "lg:grid-cols-2" : ""}`}>
      <FeedCard title="New from members" items={forum} empty="Nothing yet. Pick your state below and start a thread." />
      {groups.length > 0 && <FeedCard title="New in your groups" items={groups} />}
    </div>
  );
}

function FeedCard({ title, items, empty }: { title: string; items: FeedItem[]; empty?: string }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-900">
          {items.map((e, i) => (
            <li key={i} className="py-2 text-sm">
              <a href={e.href} className="block text-zinc-200 hover:text-emerald-400">
                <span className="line-clamp-1">{e.title}</span>
              </a>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                <span className={e.kind === "thread" ? "text-emerald-300" : "text-blue-300"}>
                  {e.kind === "thread" ? "New thread" : "Reply"}
                </span>
                {e.place && <span>{e.place}</span>}
                {e.author && <span>{e.author}</span>}
                <span>{relativeTime(e.at)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
