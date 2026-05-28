"use client";

import { useEffect, useMemo, useState } from "react";

type NewsItem = {
  id: string;
  state: string | null;
  title: string;
  summary: string | null;
  url: string;
  source_name: string | null;
  published_at: string | null;
  scraped_at: string | null;
  kratom_topic: string | null;
  ai_relevance_score: number | null;
  duplicate_count?: number | null;
  bill_id?: string | null;
  bills?:
    | { bill_number: string; state: string }
    | Array<{ bill_number: string; state: string }>
    | null;
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
type View = "list" | "compact" | "grid" | "magazine";
type PageSize = 10 | 25 | 50 | 100;

const VIEW_LABEL: Record<View, string> = {
  list: "List",
  compact: "Compact",
  grid: "Grid",
  magazine: "Magazine",
};

// Persist user picks across visits — small enough to localStorage, not
// worth a profile column. Defensive try/catch for SSR / private modes.
const LS_VIEW = "ikratom.news.view";
const LS_PAGE_SIZE = "ikratom.news.pageSize";

function loadLS(key: string): string | null {
  try { return typeof window !== "undefined" ? localStorage.getItem(key) : null; }
  catch { return null; }
}
function saveLS(key: string, value: string) {
  try { if (typeof window !== "undefined") localStorage.setItem(key, value); }
  catch { /* noop */ }
}

export function NewsList({ items, userState }: { items: NewsItem[]; userState: string | null }) {
  // Owner explicitly asked: default to ALL states, not "yours". Home-state
  // is still a one-click filter chip, just not the default scope.
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [topic, setTopic] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [view, setView] = useState<View>("list");
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [page, setPage] = useState(1);

  // Hydrate persisted picks once on mount.
  useEffect(() => {
    const v = loadLS(LS_VIEW);
    if (v === "list" || v === "compact" || v === "grid" || v === "magazine") setView(v);
    const ps = parseInt(loadLS(LS_PAGE_SIZE) ?? "");
    if ([10, 25, 50, 100].includes(ps)) setPageSize(ps as PageSize);
  }, []);

  useEffect(() => { saveLS(LS_VIEW, view); }, [view]);
  useEffect(() => { saveLS(LS_PAGE_SIZE, String(pageSize)); }, [pageSize]);

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [stateFilter, topic, query, sort, pageSize]);

  const counts = useMemo(() => {
    const yourState = userState ? items.filter((i) => i.state === userState).length : 0;
    const federal = items.filter((i) => i.state === null).length;
    return { all: items.length, yours: yourState, federal };
  }, [items, userState]);

  const statesWithNews = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.state) set.add(i.state);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = items.filter((i) => {
      if (stateFilter === "yours" && i.state !== userState) return false;
      if (stateFilter === "federal" && i.state !== null) return false;
      if (stateFilter !== "all" && stateFilter !== "yours" && stateFilter !== "federal") {
        if (i.state !== stateFilter) return false;
      }
      if (topic !== "all" && i.kratom_topic !== topic) return false;
      if (q) {
        const hay = `${i.title} ${i.summary ?? ""} ${i.source_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    arr = [...arr];
    if (sort === "relevance") {
      arr.sort((a, b) => (b.ai_relevance_score ?? 0) - (a.ai_relevance_score ?? 0));
    } else if (sort === "alpha") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      // Newest = published_at desc. Critical: NOT scraped_at — Google News
      // re-indexes 6-month-old articles all the time. Owner explicitly
      // wants the news-publication date as the canonical sort key.
      arr.sort((a, b) => {
        if (!a.published_at) return 1;
        if (!b.published_at) return -1;
        return b.published_at.localeCompare(a.published_at);
      });
    }
    return arr;
  }, [items, stateFilter, topic, query, sort, userState]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

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
            <option value="all">All states ({counts.all})</option>
            {userState && <option value="yours">Your state ({userState}, {counts.yours})</option>}
            <option value="federal">Federal ({counts.federal})</option>
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
            <option value="newest">Newest published</option>
            <option value="relevance">Most relevant</option>
            <option value="alpha">A → Z</option>
          </select>
          <select
            value={view}
            onChange={(e) => setView(e.target.value as View)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            title="Layout"
          >
            <option value="list">📄 List</option>
            <option value="compact">≡ Compact</option>
            <option value="grid">▦ Grid</option>
            <option value="magazine">▤ Magazine</option>
          </select>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value) as PageSize)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            title="Articles per page"
          >
            <option value="10">10 per page</option>
            <option value="25">25 per page</option>
            <option value="50">50 per page</option>
            <option value="100">100 per page</option>
          </select>
        </div>

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
        {totalPages > 1 && <> · page {currentPage} of {totalPages}</>}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No items match those filters.
        </div>
      ) : (
        <NewsItems items={pageItems} view={view} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
          <button
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800"
          >
            ← Previous
          </button>
          <span className="text-xs text-zinc-500">
            Page <strong className="text-zinc-200">{currentPage}</strong> of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/** Render the items in the chosen layout. Each card has its own component
 * so they can diverge without monolithic conditionals. */
function NewsItems({ items, view }: { items: NewsItem[]; view: View }) {
  if (view === "compact") {
    return (
      <ul className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800 bg-zinc-950/40">
        {items.map((i) => <CompactRow key={i.id} item={i} />)}
      </ul>
    );
  }
  if (view === "grid") {
    return (
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => <CardItem key={i.id} item={i} compact />)}
      </ul>
    );
  }
  if (view === "magazine" && items.length > 0) {
    const [hero, ...rest] = items;
    return (
      <div className="space-y-4">
        <HeroItem item={hero} />
        {rest.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((i) => <CardItem key={i.id} item={i} compact />)}
          </ul>
        )}
      </div>
    );
  }
  // Default: list
  return (
    <ul className="space-y-3">
      {items.map((i) => <CardItem key={i.id} item={i} />)}
    </ul>
  );
}

/** Color-coded dual-date display. Published wins visually; scraped is
 * meta-data only. Owner asked for both side-by-side so users see when
 * an article is freshly published vs. just newly indexed by us. */
function DualDate({ published, scraped }: { published: string | null; scraped: string | null }) {
  if (!published && !scraped) return null;
  const pub = published ? new Date(published) : null;
  const scr = scraped ? new Date(scraped) : null;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
  // Visual gap: if scraped >7d after published, the article is OLD news
  // we just discovered. Worth flagging.
  const gapDays = pub && scr ? Math.floor((scr.getTime() - pub.getTime()) / 86_400_000) : 0;
  const scrapedTone = gapDays > 7 ? "text-amber-400" : "text-blue-400";
  return (
    <span className="ml-auto flex flex-col items-end gap-0.5 text-[10px] leading-tight">
      {pub && (
        <span className="font-medium text-emerald-300" title={`Published: ${pub.toISOString()}`}>
          📰 {fmt(pub)}
        </span>
      )}
      {scr && (
        <span className={scrapedTone} title={`We scraped this: ${scr.toISOString()}${gapDays > 7 ? ` (${gapDays}d after publication)` : ""}`}>
          🛰 {fmt(scr)}
        </span>
      )}
    </span>
  );
}

function ItemMeta({ item }: { item: NewsItem }) {
  return (
    <div className="flex flex-wrap items-start gap-2 text-xs">
      {item.state ? (
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">{item.state}</span>
      ) : (
        <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-purple-300">Federal</span>
      )}
      {item.kratom_topic && (
        <span className={`rounded px-1.5 py-0.5 ${TOPIC_COLORS[item.kratom_topic] ?? "bg-zinc-900 text-zinc-400"}`}>
          {item.kratom_topic}
        </span>
      )}
      {item.ai_relevance_score != null && item.ai_relevance_score >= 0.7 && (
        <span className="text-zinc-500">{Math.round(item.ai_relevance_score * 100)}% match</span>
      )}
      {item.source_name && <span className="text-zinc-500">{item.source_name}</span>}
      {item.duplicate_count != null && item.duplicate_count > 0 && (
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400" title="Syndicated to other states">
          +{item.duplicate_count}
        </span>
      )}
      <DualDate published={item.published_at} scraped={item.scraped_at} />
    </div>
  );
}

function LinkedBillFooter({ item }: { item: NewsItem }) {
  const bill = Array.isArray(item.bills) ? item.bills[0] : item.bills;
  if (!bill || !item.bill_id) return null;
  return (
    <div className="border-t border-zinc-800 px-4 py-2">
      <a
        href={`/bills/${item.bill_id}`}
        className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline"
      >
        🔗 Linked bill: <span className="font-mono">{bill.state} {bill.bill_number}</span> →
      </a>
    </div>
  );
}

function CardItem({ item, compact = false }: { item: NewsItem; compact?: boolean }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 transition hover:border-emerald-700/50">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="block p-4">
        <ItemMeta item={item} />
        <h3 className={`mt-2 font-semibold leading-tight ${compact ? "text-[14px]" : ""}`}>{item.title}</h3>
        {!compact && item.summary && <p className="mt-2 text-sm text-zinc-400">{item.summary}</p>}
      </a>
      <LinkedBillFooter item={item} />
    </li>
  );
}

function CompactRow({ item }: { item: NewsItem }) {
  return (
    <li>
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 transition hover:bg-zinc-900/40">
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {item.state ?? "FED"}
        </span>
        <span className="flex-1 text-[13px] font-medium text-zinc-100">{item.title}</span>
        {item.source_name && <span className="text-[10px] text-zinc-500">{item.source_name}</span>}
        <DualDate published={item.published_at} scraped={item.scraped_at} />
      </a>
    </li>
  );
}

function HeroItem({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-emerald-700/30 bg-gradient-to-br from-emerald-950/30 via-zinc-950/40 to-zinc-950/60 p-6 transition hover:border-emerald-500"
    >
      <ItemMeta item={item} />
      <h2 className="mt-3 text-2xl font-bold leading-tight">{item.title}</h2>
      {item.summary && <p className="mt-3 text-sm text-zinc-300">{item.summary}</p>}
    </a>
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
