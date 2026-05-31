import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";

/**
 * "What's happening" ticker for the forum index. Last few events across
 * threads, posts, and campaigns — gives the page a pulse so visitors see
 * the platform is in use, not a ghost town.
 *
 * Server component; pulls live each time the forum index is requested.
 * Limited to N events total so a slow query doesn't block the page.
 */

type Event = {
  kind: "thread" | "post" | "campaign";
  state: string | null;
  title: string;
  href: string;
  authorName: string | null;
  createdAt: string;
};

export async function RecentActivity({ limit = 6 }: { limit?: number }) {
  const supabase = await createClient();

  // Pull each event source in parallel, then merge
  const [{ data: threads }, { data: posts }, { data: campaigns }] = await Promise.all([
    supabase
      .from("forum_threads")
      .select("id, state, title, author_id, created_at, moderation_status")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("forum_posts")
      .select("id, thread_id, author_id, created_at, moderation_status")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("campaigns")
      .select("id, title, state, created_at, active")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  // Pull thread titles for posts so we can label them
  const threadIds = Array.from(new Set((posts ?? []).map((p) => p.thread_id).filter(Boolean)));
  const { data: parentThreads } = threadIds.length
    ? await supabase.from("forum_threads").select("id, title, state").in("id", threadIds)
    : { data: [] as { id: string; title: string; state: string | null }[] };
  const threadById = new Map((parentThreads ?? []).map((t) => [t.id, t]));

  // Pull author names in one shot
  const authorIds = new Set<string>();
  for (const t of threads ?? []) if (t.author_id) authorIds.add(t.author_id);
  for (const p of posts ?? []) if (p.author_id) authorIds.add(p.author_id);
  const { data: profileRows } = authorIds.size
    ? await supabase.rpc("get_public_profiles", { p_ids: Array.from(authorIds) })
    : { data: [] as { id: string; username: string | null; state: string | null }[] };
  const nameById = new Map(
    ((profileRows ?? []) as { id: string; username: string | null; state: string | null }[])
      .map((p) => [p.id, publicHandle(p)]),
  );

  const events: Event[] = [];
  for (const t of threads ?? []) {
    events.push({
      kind: "thread",
      state: t.state,
      title: t.title,
      href: `/forum/${t.state ?? "national"}/${t.id}`,
      authorName: t.author_id ? nameById.get(t.author_id) ?? null : null,
      createdAt: t.created_at,
    });
  }
  for (const p of posts ?? []) {
    const parent = threadById.get(p.thread_id);
    if (!parent) continue;
    events.push({
      kind: "post",
      state: parent.state,
      title: parent.title,
      href: `/forum/${parent.state ?? "national"}/${p.thread_id}`,
      authorName: p.author_id ? nameById.get(p.author_id) ?? null : null,
      createdAt: p.created_at,
    });
  }
  for (const c of campaigns ?? []) {
    events.push({
      kind: "campaign",
      state: c.state,
      title: c.title,
      href: `/campaigns`,
      authorName: null,
      createdAt: c.created_at,
    });
  }

  events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const top = events.slice(0, limit);

  if (top.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Recent activity
      </h3>
      <ul className="divide-y divide-zinc-900">
        {top.map((e, i) => (
          <li key={i} className="flex items-center gap-2 py-1.5 text-xs">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                e.kind === "thread"
                  ? "bg-emerald-950/40 text-emerald-300"
                  : e.kind === "post"
                  ? "bg-blue-950/40 text-blue-300"
                  : "bg-amber-950/40 text-amber-300"
              }`}
            >
              {e.kind === "thread" ? "thread" : e.kind === "post" ? "reply" : "campaign"}
            </span>
            {e.state && (
              <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                {e.state}
              </span>
            )}
            <a href={e.href} className="min-w-0 flex-1 truncate text-zinc-300 hover:text-emerald-400">
              {e.title}
            </a>
            {e.authorName && (
              <span className="hidden shrink-0 text-zinc-600 sm:inline">— {e.authorName}</span>
            )}
            <span className="shrink-0 text-zinc-700">{relativeTime(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
