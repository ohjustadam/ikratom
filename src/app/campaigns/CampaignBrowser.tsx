"use client";

import { useMemo, useState } from "react";

type Scope = "state" | "federal" | "municipal" | "county" | "unknown";
type Stance = "anti" | "pro" | "neutral" | "unknown";

export type Campaign = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  target_locality: string | null;
  active: boolean;
  auto_generated: boolean;
  mobilization_type: string | null;
  created_at: string;
  scope: Scope;
  stance: Stance;
  bill_status: string | null;
  severity: string | null;       // routine | watch | alert | critical | null
};

type ScopeFilter = "all" | "yours" | "federal" | "state" | "local";
type StanceFilter = "all" | "anti" | "pro";
type SortMode = "urgency" | "newest" | "actions";

const SEV_RANK: Record<string, number> = { critical: 4, alert: 3, watch: 2, routine: 1 };

// State picker — every state with non-zero campaigns shows up here.
const STATES_50 = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

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
  const [scope, setScope] = useState<ScopeFilter>(userState ? "yours" : "all");
  const [stance, setStance] = useState<StanceFilter>("all");
  const [sort, setSort] = useState<SortMode>("urgency");
  // State picker — independent of the scope chips. "" = no state filter.
  // Lets a LA user view OK campaigns without flipping their saved profile state.
  const [statePicked, setStatePicked] = useState<string>("");

  // States that actually have at least one campaign — keeps the dropdown
  // honest about what's available rather than showing 50 dead options.
  const availableStates = useMemo(() => {
    const s = new Set<string>();
    for (const c of campaigns) if (c.state) s.add(c.state);
    return [...s].sort();
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => {
      // Explicit state picker beats scope when set
      if (statePicked && c.state !== statePicked) return false;

      // Scope chip — skip if a state is picked explicitly (the state picker
      // is more specific than "yours" / "federal" / etc.)
      if (!statePicked) {
        if (scope === "yours" && userState && c.state !== userState) return false;
        if (scope === "federal" && c.scope !== "federal") return false;
        if (scope === "state" && c.scope !== "state") return false;
        if (scope === "local" && c.scope !== "municipal" && c.scope !== "county") return false;
      }

      // Stance chip
      if (stance === "anti" && c.stance !== "anti") return false;
      if (stance === "pro" && c.stance !== "pro") return false;

      // Free-text search
      if (q) {
        const hay = `${c.title} ${c.blurb ?? ""} ${c.state ?? ""} ${c.target_locality ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, query, scope, stance, userState, statePicked]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "newest") {
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sort === "actions") {
      arr.sort((a, b) => (actionCounts[b.id] ?? 0) - (actionCounts[a.id] ?? 0));
    } else {
      // urgency: severity desc, then user-state first, then newest
      arr.sort((a, b) => {
        const sa = SEV_RANK[a.severity ?? ""] ?? 0;
        const sb = SEV_RANK[b.severity ?? ""] ?? 0;
        if (sa !== sb) return sb - sa;
        if (a.state === userState && b.state !== userState) return -1;
        if (b.state === userState && a.state !== userState) return 1;
        return b.created_at.localeCompare(a.created_at);
      });
    }
    return arr;
  }, [filtered, sort, actionCounts, userState]);

  // Counts per chip — computed off the unfiltered list
  const counts = useMemo(() => {
    const c = {
      yours: 0, all: campaigns.length, federal: 0, state: 0, local: 0,
      anti: 0, pro: 0,
    };
    for (const x of campaigns) {
      if (userState && x.state === userState) c.yours++;
      if (x.scope === "federal") c.federal++;
      if (x.scope === "state") c.state++;
      if (x.scope === "municipal" || x.scope === "county") c.local++;
      if (x.stance === "anti") c.anti++;
      if (x.stance === "pro") c.pro++;
    }
    return c;
  }, [campaigns, userState]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Active campaigns</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Each campaign is a one-click action. Your info auto-fills. The email goes from
          your real address — what legislators actually read.
        </p>
      </header>

      {/* Sticky search + filters */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, locality, or topic…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* State picker — pick any state to filter to its campaigns.
              Works independently of the scope chips below. */}
          <select
            value={statePicked}
            onChange={(e) => setStatePicked(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
            aria-label="Filter by state"
          >
            <option value="">All states</option>
            {availableStates.map((s) => (
              <option key={s} value={s}>
                {s}{userState === s ? " · yours" : ""}
              </option>
            ))}
            {/* Allow picking states not currently in the campaign list
                so users can see "no campaigns in X yet" rather than
                wondering why a state is missing. Show them at the
                bottom, separated. */}
            <option disabled value="">─── all 51 ───</option>
            {STATES_50.filter((s) => !availableStates.includes(s)).map((s) => (
              <option key={s} value={s}>{s} (no campaigns yet)</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
            aria-label="Sort"
          >
            <option value="urgency">🔥 By urgency</option>
            <option value="newest">🕐 Newest</option>
            <option value="actions">📈 Most action</option>
          </select>
        </div>

        {/* Scope chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <FilterChip active={scope === "all"} onClick={() => setScope("all")} count={counts.all}>
            All
          </FilterChip>
          {userState && (
            <FilterChip active={scope === "yours"} onClick={() => setScope("yours")} count={counts.yours}>
              Your state ({userState})
            </FilterChip>
          )}
          <FilterChip active={scope === "federal"} onClick={() => setScope("federal")} count={counts.federal}>
            Federal
          </FilterChip>
          <FilterChip active={scope === "state"} onClick={() => setScope("state")} count={counts.state}>
            State
          </FilterChip>
          <FilterChip active={scope === "local"} onClick={() => setScope("local")} count={counts.local}>
            City / county
          </FilterChip>
        </div>

        {/* Stance chips — secondary row */}
        <div className="mt-2 flex flex-wrap gap-2">
          <FilterChip active={stance === "all"} onClick={() => setStance("all")} subtle count={campaigns.length}>
            Any stance
          </FilterChip>
          <FilterChip active={stance === "anti"} onClick={() => setStance("anti")} subtle count={counts.anti}>
            🚫 Restrictive
          </FilterChip>
          <FilterChip active={stance === "pro"} onClick={() => setStance("pro")} subtle count={counts.pro}>
            ✅ Supportive
          </FilterChip>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState query={query} scope={scope} stance={stance} userState={userState} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              actions={actionCounts[c.id] ?? 0}
              isMine={!!userState && c.state === userState}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({ c, actions, isMine }: { c: Campaign; actions: number; isMine: boolean }) {
  const sev = c.severity;
  const isCritical = sev === "critical";
  const isAlert = sev === "alert";

  return (
    <li>
      <a
        href={`/campaigns/${c.slug}`}
        className={`block h-full rounded-lg border p-5 transition ${
          isCritical
            ? "border-red-700/50 bg-red-950/15 hover:border-red-500"
            : isAlert
            ? "border-amber-700/40 bg-amber-950/10 hover:border-amber-500"
            : isMine
            ? "border-emerald-700/50 bg-emerald-950/10 hover:border-emerald-500"
            : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ScopeBadge campaign={c} isMine={isMine} />
          {c.stance === "anti" && (
            <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
              🚫 Restrictive
            </span>
          )}
          {c.stance === "pro" && (
            <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
              ✅ Supportive
            </span>
          )}
          {sev && sev !== "routine" && sev !== "watch" && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                isCritical
                  ? "bg-red-500 text-zinc-950 animate-pulse"
                  : "bg-amber-500 text-zinc-950"
              }`}
            >
              {sev}
            </span>
          )}
          {c.bill_status === "enacted" && (
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
              enacted
            </span>
          )}
          {actions > 0 && (
            <span className="ml-auto text-[10px] text-zinc-500">
              {actions.toLocaleString()} sent
            </span>
          )}
        </div>
        <h2 className="mt-3 font-semibold leading-tight">{c.title}</h2>
        {c.blurb && (
          <p className="mt-2 line-clamp-3 text-sm text-zinc-400">{c.blurb}</p>
        )}
        {c.target_locality && c.scope !== "state" && (
          <p className="mt-2 text-[11px] text-zinc-500">📍 {c.target_locality}</p>
        )}
      </a>
    </li>
  );
}

function ScopeBadge({ campaign: c, isMine }: { campaign: Campaign; isMine: boolean }) {
  if (c.scope === "federal") {
    return (
      <span className="rounded bg-purple-950/40 px-2 py-0.5 text-xs font-semibold text-purple-300">
        Federal
      </span>
    );
  }
  if (c.scope === "municipal" || c.scope === "county") {
    return (
      <span className="rounded bg-sky-950/40 px-2 py-0.5 text-xs font-semibold text-sky-300">
        {c.state} · {c.scope === "county" ? "County" : "City"}
      </span>
    );
  }
  if (c.state) {
    return (
      <span
        className={`rounded px-2 py-0.5 text-xs font-semibold ${
          isMine ? "bg-emerald-500 text-zinc-950" : "bg-zinc-900 text-zinc-300"
        }`}
      >
        {c.state}
      </span>
    );
  }
  return (
    <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-zinc-400">
      —
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  subtle,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? subtle
            ? "bg-zinc-700 text-zinc-100"
            : "bg-emerald-500 text-zinc-950"
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500 hover:text-zinc-100"
      }`}
    >
      {children}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function EmptyState({
  query, scope, stance, userState,
}: {
  query: string;
  scope: ScopeFilter;
  stance: StanceFilter;
  userState: string | null;
}) {
  if (query) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-sm text-zinc-400">
          No campaigns matched &ldquo;<span className="text-zinc-200">{query}</span>&rdquo;.
        </p>
      </div>
    );
  }
  if (scope === "yours" && userState) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
        <p className="text-3xl">🎯</p>
        <h3 className="mt-3 text-lg font-semibold">No active campaigns in {userState} right now</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
          Quiet doesn&apos;t mean inactive. Check what&apos;s happening federally and in
          neighboring states — your voice carries weight on out-of-state campaigns when you
          have a stake.
        </p>
      </div>
    );
  }
  if (stance !== "all") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-sm text-zinc-400">No {stance === "anti" ? "restrictive" : "supportive"} campaigns under that filter.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
      <p className="text-sm text-zinc-400">No campaigns under that filter.</p>
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
