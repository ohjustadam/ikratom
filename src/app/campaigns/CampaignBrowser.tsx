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
  is_standing: boolean;          // always-on per-state backbone (no expiry)
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
  signedIn = false,
  emailConnected = false,
}: {
  campaigns: Campaign[];
  userState: string | null;
  actionCounts: Record<string, number>;
  signedIn?: boolean;
  emailConnected?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Default to "All" so every campaign is visible to everyone regardless of
  // state (owner policy 2026-06-22); the urgency sort still floats the user's
  // own state to the top, and the "Your state" chip is one tap away.
  const [scope, setScope] = useState<ScopeFilter>("all");
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

  // The single highest-leverage campaign right now — independent of the
  // user's chosen sort. Drives the "take action" half of the nudge banner.
  const mostUrgent = useMemo(() => {
    if (campaigns.length === 0) return null;
    return [...campaigns].sort((a, b) => {
      const sa = SEV_RANK[a.severity ?? ""] ?? 0;
      const sb = SEV_RANK[b.severity ?? ""] ?? 0;
      if (sa !== sb) return sb - sa;
      if (a.state === userState && b.state !== userState) return -1;
      if (b.state === userState && a.state !== userState) return 1;
      return b.created_at.localeCompare(a.created_at);
    })[0];
  }, [campaigns, userState]);

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
          Every campaign is a one-click action you can take from anywhere — wherever you
          live. Your info auto-fills, and the email goes from your real address, which is
          what legislators actually read.
        </p>
      </header>

      <ActionNudge signedIn={signedIn} emailConnected={emailConnected} topCampaign={mostUrgent} />

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
        className={`ik-lift block h-full rounded-xl border p-5 ${
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
          {c.is_standing && (
            <span className="rounded bg-indigo-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-300" title="Always-on campaign — no end date">
              📌 Standing
            </span>
          )}
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

/**
 * Top-of-page nudge that ties together the two things that turn a browser into
 * an advocate: (1) connect your email once → one-click sends everywhere, and
 * (2) take action on the campaign that matters most right now. Adapts to the
 * visitor: anon → join; signed-in but no email → connect; ready → act.
 */
function ActionNudge({
  signedIn,
  emailConnected,
  topCampaign,
}: {
  signedIn: boolean;
  emailConnected: boolean;
  topCampaign: Campaign | null;
}) {
  // Anon — can't connect email without an account, so nudge to join.
  if (!signedIn) {
    return (
      <div className="mb-6 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-4">
        <p className="text-sm font-semibold text-emerald-200">
          📣 Every campaign here is one click — for everyone, in any state.
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Create a free account and your letters auto-fill with your info, sent from your
          own address — what legislators actually read.
        </p>
        <a
          href="/signup"
          className="mt-3 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Join free → start taking action
        </a>
      </div>
    );
  }

  // Signed in but no email connected — the highest-leverage nudge.
  if (!emailConnected) {
    return (
      <div className="mb-6 rounded-lg border-2 border-dashed border-emerald-700/50 bg-emerald-950/10 p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
          ⚡ Sync your email once — then send in one click
        </p>
        <p className="mt-1 text-sm text-zinc-300">
          Connect your email and any campaign below sends in a single click — each message
          from <strong>your</strong> address, each in your Sent folder. Narrowest scope only
          (send-only); we never read your inbox.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href="/api/oauth/google/start"
            className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
          >
            <GoogleGlyph /> Connect Gmail →
          </a>
          <a
            href="/api/oauth/outlook/start"
            className="inline-flex items-center gap-2 rounded-md bg-[#0078D4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#106EBE]"
          >
            Connect Outlook →
          </a>
          <span className="text-xs text-zinc-500">
            No Gmail / Outlook? You can still send from your own email on any campaign.
          </span>
        </div>
      </div>
    );
  }

  // Signed in + connected — nudge to act on the campaign that matters most.
  if (topCampaign) {
    const urgent = topCampaign.severity === "critical" || topCampaign.severity === "alert";
    return (
      <a
        href={`/campaigns/${topCampaign.slug}`}
        className="ik-card mb-6 block rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-4 hover:border-emerald-500"
      >
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
          ✓ Email connected · one-click ready{urgent ? " · 🔴 urgent" : ""}
        </p>
        <p className="mt-1 text-sm text-zinc-200">
          Take action now: <strong>{topCampaign.title}</strong>
        </p>
        <p className="mt-0.5 text-xs text-emerald-400">Open campaign → send in one click →</p>
      </a>
    );
  }

  return null;
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
