"use client";

import { useMemo, useState } from "react";

/**
 * ForumStateNav — the "pick a state" surface for the forum index.
 *
 * Replaces the old static alphabetical 51-card grid (which made it hard to
 * tell where anything was happening). Adds:
 *   - a search box ("jump to your state")
 *   - a sort toggle: Most active (default) vs A–Z
 *   - your home state pinned first + highlighted
 *   - activity-first ordering so live state forums float to the top
 *
 * Pure client display — receives already-public, serializable props (no PII;
 * names come pre-resolved). No server actions here.
 */

type StateRow = { abbr: string; name: string; status: string | null };
type StateActivity = {
  threads: number;
  posts: number;
  lastActivity: string | null;
  unread: number;
  subMode: "alerts" | "digest" | "mute" | null;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  legal: { label: "Legal", cls: "bg-emerald-950/40 text-emerald-300" },
  kcpa: { label: "KCPA", cls: "bg-blue-950/40 text-blue-300" },
  banned: { label: "Banned", cls: "bg-red-950/40 text-red-300" },
  restricted: { label: "Restricted", cls: "bg-amber-950/40 text-amber-300" },
};

function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export function ForumStateNav({
  states,
  activity,
  userState,
}: {
  states: StateRow[];
  activity: Record<string, StateActivity>;
  userState: string | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"active" | "az">("active");

  const totalActive = useMemo(
    () => states.filter((s) => {
      const a = activity[s.abbr];
      return a && (a.threads > 0 || a.posts > 0);
    }).length,
    [states, activity],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? states.filter((s) => s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q))
      : states.slice();

    const lastTs = (abbr: string) => {
      const a = activity[abbr];
      return a?.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    };
    const vol = (abbr: string) => {
      const a = activity[abbr];
      return a ? a.threads + a.posts : 0;
    };

    filtered.sort((x, y) => {
      // Home state always first.
      const mineX = x.abbr === userState ? 1 : 0;
      const mineY = y.abbr === userState ? 1 : 0;
      if (mineX !== mineY) return mineY - mineX;
      if (sort === "az") return x.name.localeCompare(y.name);
      // Most active: recency, then volume, then alpha.
      const tX = lastTs(x.abbr), tY = lastTs(y.abbr);
      if (tX !== tY) return tY - tX;
      const vX = vol(x.abbr), vY = vol(y.abbr);
      if (vX !== vY) return vY - vX;
      return x.name.localeCompare(y.name);
    });
    return filtered;
  }, [states, activity, userState, query, sort]);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          State forums
          <span className="ml-2 font-normal normal-case text-zinc-600">
            {totalActive} active · {states.length} total
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a state…"
            aria-label="Search states"
            className="w-40 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none sm:w-52"
          />
          <div className="flex overflow-hidden rounded-md border border-zinc-800 text-xs">
            <button
              onClick={() => setSort("active")}
              className={`px-2.5 py-1.5 ${sort === "active" ? "bg-emerald-600 font-semibold text-white" : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"}`}
            >
              Most active
            </button>
            <button
              onClick={() => setSort("az")}
              className={`px-2.5 py-1.5 ${sort === "az" ? "bg-emerald-600 font-semibold text-white" : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"}`}
            >
              A–Z
            </button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center text-sm text-zinc-500">
          No states match “{query}”.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((st) => {
            const tag = STATUS_BADGE[st.status ?? ""] ?? null;
            const isMine = userState === st.abbr;
            const a = activity[st.abbr];
            const muted = a?.subMode === "mute";
            const active = !!a && (a.threads > 0 || a.posts > 0);
            const last = relTime(a?.lastActivity ?? null);
            return (
              <a
                key={st.abbr}
                href={`/forum/${st.abbr}`}
                className={`flex items-start justify-between gap-2 rounded-md border px-4 py-3 transition hover:border-emerald-500 ${
                  isMine ? "border-emerald-700/50 bg-emerald-950/10" : "border-zinc-800 bg-zinc-950/40"
                } ${muted ? "opacity-50" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500">{st.abbr}</span>
                    <span className="font-medium">{st.name}</span>
                    {isMine && (
                      <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
                        Yours
                      </span>
                    )}
                    {!!a?.unread && a.unread > 0 && (
                      <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                        {a.unread > 99 ? "99+" : a.unread} new
                      </span>
                    )}
                    {a?.subMode === "alerts" && <span title="Alerts on">🔔</span>}
                    {a?.subMode === "digest" && <span title="Daily digest">📰</span>}
                    {a?.subMode === "mute" && <span title="Muted">🔕</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                    <span>{a?.threads ?? 0} threads · {a?.posts ?? 0} posts</span>
                    {active && last && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-emerald-400/80">active {last}</span>
                      </>
                    )}
                  </div>
                </div>
                {tag && (
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${tag.cls}`}>
                    {tag.label}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
