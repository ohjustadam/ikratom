"use client";

import { useMemo, useState } from "react";

type Bill = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary: string | null;
  summary_ai: string | null;
  advocacy_callout: string | null;
  status: string | null;
  kratom_relevance: string | null;
  relevance_confidence: number | null;
  last_action: string | null;
  last_action_at: string | null;
  source_url: string | null;
};

const RELEVANCE: Record<string, { label: string; cls: string }> = {
  pro: { label: "Pro-kratom", cls: "bg-emerald-950/40 text-emerald-300" },
  anti: { label: "Anti-kratom", cls: "bg-red-950/40 text-red-300" },
  neutral: { label: "Neutral", cls: "bg-zinc-900 text-zinc-400" },
};

const STATUS_LABELS: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  passed_chamber: "Passed chamber",
  enacted: "Enacted",
  dead: "Dead",
};

type Sort = "recent" | "state" | "alpha";

export function BillsBrowser({ bills, userState }: { bills: Bill[]; userState: string | null }) {
  const [stateFilter, setStateFilter] = useState<string>(userState ? "yours" : "all");
  const [relevanceFilter, setRelevanceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const statesPresent = useMemo(() => {
    return Array.from(new Set(bills.map((b) => b.state))).sort();
  }, [bills]);

  const relevanceCounts = useMemo(() => {
    const c: Record<string, number> = { all: bills.length, pro: 0, anti: 0, neutral: 0 };
    for (const b of bills) {
      const r = b.kratom_relevance ?? "neutral";
      c[r] = (c[r] ?? 0) + 1;
    }
    return c;
  }, [bills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = bills.filter((b) => {
      // State
      if (stateFilter === "yours" && b.state !== userState) return false;
      if (stateFilter !== "all" && stateFilter !== "yours" && b.state !== stateFilter) return false;
      // Relevance
      if (relevanceFilter !== "all") {
        const r = b.kratom_relevance ?? "neutral";
        if (r !== relevanceFilter) return false;
      }
      // Status
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      // Search
      if (q) {
        const hay = `${b.bill_number} ${b.title ?? ""} ${b.summary ?? ""} ${b.last_action ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    arr = [...arr];
    if (sort === "state") {
      arr.sort((a, b) => `${a.state}${a.bill_number}`.localeCompare(`${b.state}${b.bill_number}`));
    } else if (sort === "alpha") {
      arr.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    } else {
      arr.sort((a, b) => {
        if (!a.last_action_at) return 1;
        if (!b.last_action_at) return -1;
        return b.last_action_at.localeCompare(a.last_action_at);
      });
    }
    return arr;
  }, [bills, stateFilter, relevanceFilter, statusFilter, query, sort, userState]);

  if (bills.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-3xl">📜</p>
        <h2 className="mt-3 text-lg font-semibold">No bills indexed yet</h2>
        <p className="mt-2 text-sm text-zinc-400">
          The OpenStates bill sync hasn&apos;t run yet. Admin can trigger via{" "}
          <code className="rounded bg-zinc-900 px-2 py-0.5">npm run sync:bills</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bill number, title, summary…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            {userState && <option value="yours">Your state ({userState})</option>}
            <option value="all">All states ({bills.length})</option>
            <optgroup label="By state">
              {statesPresent.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </optgroup>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">Any status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="recent">Most recent action</option>
            <option value="state">By state, A→Z</option>
            <option value="alpha">Title A→Z</option>
          </select>
        </div>

        {/* Relevance chips */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Chip active={relevanceFilter === "all"} onClick={() => setRelevanceFilter("all")} count={relevanceCounts.all}>
            All
          </Chip>
          <Chip
            active={relevanceFilter === "anti"}
            onClick={() => setRelevanceFilter("anti")}
            count={relevanceCounts.anti}
            color={RELEVANCE.anti.cls}
          >
            🚨 Anti-kratom
          </Chip>
          <Chip
            active={relevanceFilter === "pro"}
            onClick={() => setRelevanceFilter("pro")}
            count={relevanceCounts.pro}
            color={RELEVANCE.pro.cls}
          >
            ✓ Pro-kratom
          </Chip>
          <Chip
            active={relevanceFilter === "neutral"}
            onClick={() => setRelevanceFilter("neutral")}
            count={relevanceCounts.neutral}
            color={RELEVANCE.neutral.cls}
          >
            Neutral
          </Chip>
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-500">
        {filtered.length} bill{filtered.length === 1 ? "" : "s"}
        {stateFilter === "yours" && userState && <> in {userState}</>}
        {stateFilter !== "all" && stateFilter !== "yours" && <> in {stateFilter}</>}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No bills match those filters.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((b) => {
            const tag = RELEVANCE[b.kratom_relevance ?? "neutral"] ?? RELEVANCE.neutral;
            const status = b.status ? (STATUS_LABELS[b.status] ?? b.status) : null;
            const isMine = userState === b.state;
            return (
              <li
                key={b.id}
                className={`rounded-lg border bg-zinc-950/40 p-4 ${
                  isMine ? "border-emerald-700/40" : "border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                    {b.state} · {b.bill_number}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${tag.cls}`}>{tag.label}</span>
                  {status && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">{status}</span>
                  )}
                  {isMine && (
                    <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                      YOUR STATE
                    </span>
                  )}
                  {b.last_action_at && (
                    <span className="ml-auto text-zinc-500">
                      {new Date(b.last_action_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <h3 className="mt-2 text-sm font-medium leading-snug">
                  {b.title || "(untitled)"}
                </h3>
                {/* Prefer AI summary when available; fall back to OpenStates raw. */}
                {(b.summary_ai || b.summary) && (
                  <p className="mt-1 text-sm text-zinc-300">{b.summary_ai || b.summary}</p>
                )}
                {b.advocacy_callout && (
                  <p className="mt-2 rounded-md border border-emerald-900/30 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
                    <span className="font-semibold text-emerald-400">For advocates: </span>
                    {b.advocacy_callout}
                  </p>
                )}
                {b.last_action && (
                  <p className="mt-1 text-xs text-zinc-500">
                    <span className="text-zinc-600">Last action: </span>
                    {b.last_action}
                  </p>
                )}
                {b.source_url && (
                  <a
                    href={b.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs text-emerald-400 hover:underline"
                  >
                    Read on OpenStates ↗
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, count, color, children }: {
  active: boolean; onClick: () => void; count: number; color?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 transition ${
        active
          ? "bg-emerald-500 font-semibold text-zinc-950"
          : color
          ? `${color} hover:opacity-80`
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
      }`}
    >
      {children}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
