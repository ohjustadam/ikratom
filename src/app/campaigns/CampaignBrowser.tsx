"use client";

import { useMemo, useState } from "react";

type Campaign = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  active: boolean;
};

type Filter = "all" | "yours" | "federal";

export function CampaignBrowser({
  campaigns,
  userState,
  actionCounts,
}: {
  campaigns: Campaign[];
  userState: string | null;
  actionCounts: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(userState ? "yours" : "all");

  // Sort: user's state first, then alphabetical by state, then no-state at end
  const sorted = useMemo(() => {
    const arr = [...campaigns];
    arr.sort((a, b) => {
      if (a.state === userState && b.state !== userState) return -1;
      if (b.state === userState && a.state !== userState) return 1;
      const as = a.state ?? "ZZ";
      const bs = b.state ?? "ZZ";
      if (as !== bs) return as.localeCompare(bs);
      return a.title.localeCompare(b.title);
    });
    return arr;
  }, [campaigns, userState]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((c) => {
      if (filter === "yours" && userState && c.state !== userState) return false;
      if (filter === "federal" && c.state !== null) return false;
      if (q) {
        const hay = `${c.title} ${c.blurb ?? ""} ${c.state ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sorted, query, filter, userState]);

  const yoursCount = userState
    ? campaigns.filter((c) => c.state === userState).length
    : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Active campaigns</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Each campaign is a one-click action. Your info auto-fills. The email goes from
          your real address — what legislators actually read.
        </p>
      </header>

      {/* Sticky search + filter */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campaigns by title, state, or topic…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {userState && (
            <FilterChip
              active={filter === "yours"}
              onClick={() => setFilter("yours")}
              count={yoursCount}
            >
              Your state ({userState})
            </FilterChip>
          )}
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            count={campaigns.length}
          >
            All states
          </FilterChip>
          <FilterChip
            active={filter === "federal"}
            onClick={() => setFilter("federal")}
            count={campaigns.filter((c) => c.state === null).length}
          >
            Federal
          </FilterChip>
        </div>
      </div>

      {/* User's state hero — only when filter is "all" and user has state */}
      {filter === "all" && userState && yoursCount > 0 && (
        <p className="mb-4 text-xs text-zinc-500">
          ↓ Showing campaigns in <span className="text-emerald-400">{userState}</span> first
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const isMine = userState && c.state === userState;
            const actions = actionCounts[c.id] ?? 0;
            return (
              <li key={c.id}>
                <a
                  href={`/campaigns/${c.slug}`}
                  className={`block h-full rounded-lg border p-5 transition ${
                    isMine
                      ? "border-emerald-700/50 bg-emerald-950/10 hover:border-emerald-500"
                      : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    {c.state ? (
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          isMine
                            ? "bg-emerald-500 text-zinc-950"
                            : "bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {c.state}
                      </span>
                    ) : (
                      <span className="rounded bg-purple-950/40 px-2 py-0.5 text-xs font-semibold text-purple-300">
                        Federal
                      </span>
                    )}
                    {actions > 0 && (
                      <span className="text-[11px] text-zinc-500">
                        {actions.toLocaleString()} sent
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 font-semibold leading-tight">{c.title}</h2>
                  {c.blurb && (
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-400">{c.blurb}</p>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-emerald-500 text-zinc-950"
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500 hover:text-zinc-100"
      }`}
    >
      {children}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
      <p className="text-sm text-zinc-400">
        {query ? (
          <>No campaigns matched &ldquo;<span className="text-zinc-200">{query}</span>&rdquo;.</>
        ) : (
          "No campaigns under that filter."
        )}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
