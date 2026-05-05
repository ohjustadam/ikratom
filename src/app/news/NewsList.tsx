"use client";

import { useMemo, useState } from "react";

type NewsItem = {
  id: string;
  state: string | null;
  title: string;
  summary: string | null;
  url: string;
  source_name: string | null;
  published_at: string | null;
  kratom_topic: string | null;
  ai_relevance_score: number | null;
  duplicate_count?: number | null;
};

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const TOPIC_COLORS: Record<string, string> = {
  legislation: "bg-emerald-950/40 text-emerald-300",
  science: "bg-blue-950/40 text-blue-300",
  business: "bg-amber-950/40 text-amber-300",
  enforcement: "bg-red-950/40 text-red-300",
  culture: "bg-purple-950/40 text-purple-300",
};

type Sort = "newest" | "relevance" | "alpha";

export function NewsList({ items, userState }: { items: NewsItem[]; userState: string | null }) {
  const [stateFilter, setStateFilter] = useState<string>(userState ? "yours" : "all");
  const [topic, setTopic] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  // Counts
  const counts = useMemo(() => {
    const yourState = userState ? items.filter((i) => i.state === userState).length : 0;
    const federal = items.filter((i) => i.state === null).length;
    return { all: items.length, yours: yourState, federal };
  }, [items, userState]);

  // States that actually have news (for dropdown)
  const statesWithNews = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.state) set.add(i.state);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = items.filter((i) => {
      // State filter
      if (stateFilter === "yours" && i.state !== userState) return false;
      if (stateFilter === "federal" && i.state !== null) return false;
      if (stateFilter !== "all" && stateFilter !== "yours" && stateFilter !== "federal") {
        if (i.state !== stateFilter) return false;
      }
      // Topic
      if (topic !== "all" && i.kratom_topic !== topic) return false;
      // Search
      if (q) {
        const hay = `${i.title} ${i.summary ?? ""} ${i.source_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Sort
    arr = [...arr];
    if (sort === "relevance") {
      arr.sort((a, b) => (b.ai_relevance_score ?? 0) - (a.ai_relevance_score ?? 0));
    } else if (sort === "alpha") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      // newest first (default)
      arr.sort((a, b) => {
        if (!a.published_at) return 1;
        if (!b.published_at) return -1;
        return b.published_at.localeCompare(a.published_at);
      });
    }
    return arr;
  }, [items, stateFilter, topic, query, sort, userState]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-3xl">📰</p>
        <h2 className="mt-3 text-lg font-semibold">News is queued — first scrape pending</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
          Daily AI-curated kratom news per state. The first run hasn&apos;t completed yet.
        </p>
        <p className="mt-5 text-xs text-zinc-500">
          Admin: <code className="rounded bg-zinc-900 px-2 py-0.5">npm run sync:news:rss</code>
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
              placeholder="Search title, summary, source…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            {userState && <option value="yours">Your state ({userState})</option>}
            <option value="all">All states</option>
            <option value="federal">Federal</option>
            <optgroup label="By state">
              {STATES.filter((s) => statesWithNews.includes(s)).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </optgroup>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="relevance">Most relevant</option>
            <option value="alpha">A → Z</option>
          </select>
        </div>

        {/* Topic chips */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <TopicPill active={topic === "all"} onClick={() => setTopic("all")}>
            All topics
          </TopicPill>
          {Object.keys(TOPIC_COLORS).map((t) => (
            <TopicPill key={t} active={topic === t} onClick={() => setTopic(t)} color={TOPIC_COLORS[t]}>
              {t}
            </TopicPill>
          ))}
        </div>
      </div>

      {/* Result count */}
      <p className="mb-3 text-xs text-zinc-500">
        {filtered.length} article{filtered.length === 1 ? "" : "s"}
        {stateFilter === "yours" && userState && <> in {userState}</>}
        {stateFilter !== "all" && stateFilter !== "yours" && stateFilter !== "federal" && <> in {stateFilter}</>}
        {stateFilter === "federal" && " (federal)"}
        {topic !== "all" && <> · topic: {topic}</>}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No items match those filters.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((i) => (
            <li key={i.id}>
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-emerald-700/50"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {i.state ? (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{i.state}</span>
                  ) : (
                    <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-purple-300">Federal</span>
                  )}
                  {i.kratom_topic && (
                    <span className={`rounded px-1.5 py-0.5 ${TOPIC_COLORS[i.kratom_topic] ?? "bg-zinc-900 text-zinc-400"}`}>
                      {i.kratom_topic}
                    </span>
                  )}
                  {i.ai_relevance_score != null && i.ai_relevance_score >= 0.7 && (
                    <span className="text-zinc-500">{Math.round(i.ai_relevance_score * 100)}% match</span>
                  )}
                  {i.source_name && <span className="text-zinc-500">{i.source_name}</span>}
                  {i.duplicate_count != null && i.duplicate_count > 0 && (
                    <span
                      className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400"
                      title="The same story was syndicated to other states"
                    >
                      +{i.duplicate_count} more
                    </span>
                  )}
                  {i.published_at && (
                    <span className="ml-auto text-zinc-600">{new Date(i.published_at).toLocaleDateString()}</span>
                  )}
                </div>
                <h3 className="mt-2 font-semibold leading-tight">{i.title}</h3>
                {i.summary && <p className="mt-2 text-sm text-zinc-400">{i.summary}</p>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopicPill({ active, onClick, color, children }: {
  active: boolean; onClick: () => void; color?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 capitalize transition ${
        active
          ? "bg-emerald-500 text-zinc-950"
          : color
          ? `${color} hover:opacity-80`
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
      }`}
    >
      {children}
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
