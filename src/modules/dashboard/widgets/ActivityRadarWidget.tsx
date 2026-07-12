import { createClient } from "@/lib/supabase/server";

/**
 * Activity radar — at-a-glance "what's happening on the platform right
 * now." Sources merged + sorted by recency:
 *   - newest forum threads (approved)
 *   - newest forum posts (approved, with parent thread title)
 *   - newest active campaigns
 *   - lounge chat: count of users who posted in the last hour
 *
 * Capped at 8 events, plus a separator strip showing "active in lounge."
 *
 * Aesthetic: tight, monospace, color-coded. Mirrors /forum's
 * RecentActivity but tuned for the cockpit (denser, smaller).
 */
export async function ActivityRadarWidget() {
  const supabase = await createClient();
  const cutoffHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [{ data: threads }, { data: posts }, { data: campaigns }, { data: chatActivity }] = await Promise.all([
    supabase
      .from("forum_threads")
      .select("id, state, title, created_at")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("forum_posts")
      .select("id, thread_id, created_at, moderation_status")
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("campaigns")
      .select("id, slug, title, state, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("chat_messages")
      .select("user_id")
      .eq("room", "lounge")
      .gte("created_at", cutoffHour),
  ]);

  // Resolve parent thread titles for posts
  const threadIds = Array.from(new Set((posts ?? []).map((p) => p.thread_id).filter(Boolean)));
  const { data: parentThreads } = threadIds.length
    ? await supabase.from("forum_threads").select("id, title, state").in("id", threadIds)
    : { data: [] as { id: string; title: string; state: string | null }[] };
  const threadById = new Map((parentThreads ?? []).map((t) => [t.id, t]));

  type Event = { kind: "thread" | "post" | "campaign"; state: string | null; title: string; href: string; createdAt: string };
  const events: Event[] = [];
  for (const t of threads ?? []) {
    events.push({
      kind: "thread",
      state: t.state,
      title: t.title,
      href: `/forum/${t.state ?? "national"}/${t.id}`,
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
      createdAt: p.created_at,
    });
  }
  for (const c of campaigns ?? []) {
    events.push({
      kind: "campaign",
      state: c.state,
      title: c.title,
      href: `/campaigns/${c.slug}`,
      createdAt: c.created_at,
    });
  }

  events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const top = events.slice(0, 8);

  const uniqueChatPosters = new Set(((chatActivity ?? []) as { user_id: string }[]).map((c) => c.user_id)).size;

  if (top.length === 0 && uniqueChatPosters === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">radar</p>
          <h2 className="text-sm font-bold text-zinc-100">Activity radar</h2>
        </div>
        {uniqueChatPosters > 0 && (
          <a
            href="/forum"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950/30 px-2 py-1 text-[10px] font-mono text-emerald-300 hover:bg-emerald-950/50"
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {uniqueChatPosters} active in lounge
          </a>
        )}
      </div>
      <ul className="divide-y divide-zinc-900">
        {top.map((e, i) => (
          <li key={i}>
            <a
              href={e.href}
              className="flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-zinc-950/60"
            >
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
              <span className="min-w-0 flex-1 truncate text-zinc-300">{e.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-700">{rel(e.createdAt)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function rel(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
