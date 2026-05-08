import { TAG_COLORS, TAG_LABELS, type ForumTag, type ThreadRow } from "@/modules/forum/types";

const TAGS: ForumTag[] = ["general", "legislation", "news", "event", "meetup", "market"];

export function ThreadList({
  threads,
  state,
  currentTag,
  currentSort,
  userState,
}: {
  threads: ThreadRow[];
  state: string;
  currentTag: string;
  currentSort: string;
  userState: string | null;
}) {
  return (
    <div>
      {/* Tag chips */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <TagPill href={hrefWith(state, "all", currentSort)} active={currentTag === "all"}>
          All
        </TagPill>
        {TAGS.map((t) => (
          <TagPill
            key={t}
            href={hrefWith(state, t, currentSort)}
            active={currentTag === t}
            color={TAG_COLORS[t]}
          >
            {TAG_LABELS[t]}
          </TagPill>
        ))}
      </div>

      {/* Sort */}
      <div className="mb-4 flex items-center gap-3 border-b border-zinc-800 pb-3 text-xs text-zinc-400">
        <span>Sort:</span>
        <SortLink href={hrefWith(state, currentTag, "hot")} active={currentSort === "hot"}>
          Hot
        </SortLink>
        <SortLink href={hrefWith(state, currentTag, "new")} active={currentSort === "new"}>
          New
        </SortLink>
        <SortLink href={hrefWith(state, currentTag, "top")} active={currentSort === "top"}>
          Top
        </SortLink>
      </div>

      {threads.length === 0 ? (
        <EmptyState state={state} />
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => {
            const isOwnState = userState === t.author_state;
            return (
              <li key={t.id}>
                <a
                  href={`/forum/${state}/${t.id}`}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-700/50"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {t.pinned && (
                      <span className="rounded bg-amber-950/40 px-1.5 py-0.5 font-semibold text-amber-300">
                        📌 Pinned
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 font-semibold ${TAG_COLORS[t.tag as ForumTag] ?? "bg-zinc-900 text-zinc-300"}`}
                    >
                      {TAG_LABELS[t.tag as ForumTag] ?? t.tag}
                    </span>
                    {t.residents_only && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                        🔒 {state}-only replies
                      </span>
                    )}
                    {t.locked && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">
                        Locked
                      </span>
                    )}
                    {t.system_generated && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
                        🤖 iKratom bot
                      </span>
                    )}
                    {t.author_state && t.author_state !== state && (
                      <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-purple-300">
                        From {t.author_state}
                      </span>
                    )}
                    {isOwnState && (
                      <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
                        Your state
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold leading-tight">{t.title}</h3>
                  {t.body && (
                    <p className="line-clamp-2 text-sm text-zinc-400">{t.body}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span>↑ {t.upvote_count}</span>
                    <span>★ {t.helpful_count}</span>
                    <span>💬 {t.post_count}</span>
                    <span className="ml-auto">{timeAgo(t.last_activity_at)}</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function hrefWith(state: string, tag: string, sort: string): string {
  const params = new URLSearchParams();
  if (tag !== "all") params.set("tag", tag);
  if (sort !== "hot") params.set("sort", sort);
  const qs = params.toString();
  return `/forum/${state}${qs ? `?${qs}` : ""}`;
}

function TagPill({
  href, active, color, children,
}: { href: string; active: boolean; color?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`rounded-full px-3 py-1 transition ${
        active
          ? "bg-emerald-500 font-semibold text-zinc-950"
          : color
          ? `${color} hover:opacity-80`
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
      }`}
    >
      {children}
    </a>
  );
}

function SortLink({
  href, active, children,
}: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={active ? "font-semibold text-emerald-400" : "hover:text-emerald-400"}
    >
      {children}
    </a>
  );
}

function EmptyState({ state }: { state: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
      <p className="text-sm text-zinc-400">No threads here yet.</p>
      <a
        href={`/forum/${state}/new`}
        className="mt-3 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
      >
        Start the first conversation →
      </a>
    </div>
  );
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
