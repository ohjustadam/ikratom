"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type PaperRow = {
  id: string;
  pubmed_id: string | null;
  title: string;
  authors: string[] | null;
  journal: string | null;
  publication_year: number | null;
  study_type: string | null;
  topics: string[] | null;
  ai_methodology_quality: number | null;
  ai_evidence_strength: string | null;
  ai_key_findings_md: string | null;
  ai_distinguishes_natural_vs_synthetic: boolean | null;
  doi: string | null;
  full_text_url: string | null;
  retracted: boolean | null;
  citation_count: number | null;
};

const STRENGTH_COLORS: Record<string, string> = {
  strong: "border-emerald-700/50 bg-emerald-950/20 text-emerald-300",
  moderate: "border-emerald-900/40 bg-emerald-950/10 text-emerald-400",
  weak: "border-amber-700/40 bg-amber-950/10 text-amber-300",
  preliminary: "border-zinc-700 bg-zinc-950/40 text-zinc-400",
  inconclusive: "border-zinc-800 bg-zinc-950/40 text-zinc-500",
};

const STUDY_TYPE_LABEL: Record<string, string> = {
  rct: "RCT",
  review: "Review",
  observational: "Observational",
  case_report: "Case report",
  in_vitro: "In vitro",
  animal: "Animal",
  survey: "Survey",
  clinical: "Clinical",
};

type ViewMode = "grid" | "compact" | "list";
type SortKey = "year_desc" | "year_asc" | "quality_desc" | "citations_desc" | "alpha";

const VIEW_STORAGE = "research:view";
const SORT_STORAGE = "research:sort";

/**
 * Client-side browser for /research. Receives an already-filtered array
 * of papers from the server (which still handles topic/type/quality
 * filters via search-params); this component layers on:
 *
 *   - Three view modes (grid / compact / list) with persisted preference
 *   - Five sort options applied client-side (no page reload)
 *   - Free-text title/author/journal search filter
 *
 * Owner directive 2026-05-15:
 *   'show the papers in different viewable templates. show them in a
 *    more compact way and not just have a super long scrolling list.
 *    the sorting should be dynamic and real time, boxed.'
 */
export function ResearchBrowser({ papers }: { papers: PaperRow[] }) {
  // Load persisted preferences (localStorage). Default = compact + year_desc.
  const [view, setView] = useState<ViewMode>("compact");
  const [sortBy, setSortBy] = useState<SortKey>("year_desc");
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE) as ViewMode | null;
      const s = localStorage.getItem(SORT_STORAGE) as SortKey | null;
      if (v === "grid" || v === "compact" || v === "list") setView(v);
      if (s) setSortBy(s);
    } catch { /* localStorage unavailable */ }
  }, []);

  function persistView(v: ViewMode) {
    setView(v);
    try { localStorage.setItem(VIEW_STORAGE, v); } catch { /* */ }
  }
  function persistSort(s: SortKey) {
    setSortBy(s);
    try { localStorage.setItem(SORT_STORAGE, s); } catch { /* */ }
  }

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = papers.filter((p) => {
      if (!q) return true;
      const hay = `${p.title} ${(p.authors ?? []).join(" ")} ${p.journal ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    arr = [...arr];
    const yearOf = (p: PaperRow) => p.publication_year ?? -Infinity;
    switch (sortBy) {
      case "year_asc":
        arr.sort((a, b) => yearOf(a) - yearOf(b));
        break;
      case "quality_desc":
        arr.sort((a, b) => (b.ai_methodology_quality ?? -1) - (a.ai_methodology_quality ?? -1));
        break;
      case "citations_desc":
        arr.sort((a, b) => (b.citation_count ?? -1) - (a.citation_count ?? -1));
        break;
      case "alpha":
        arr.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "year_desc":
      default:
        arr.sort((a, b) => yearOf(b) - yearOf(a));
    }
    return arr;
  }, [papers, sortBy, query]);

  return (
    <div>
      {/* Toolbar: search + sort + view-mode */}
      <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, authors, journal…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => persistSort(e.target.value as SortKey)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            title="Sort order"
          >
            <option value="year_desc">Year ↓ newest first</option>
            <option value="year_asc">Year ↑ oldest first</option>
            <option value="quality_desc">Methodology quality ↓</option>
            <option value="citations_desc">Citation count ↓</option>
            <option value="alpha">Title A → Z</option>
          </select>
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
            <ViewButton mode="grid" current={view} onClick={persistView} label="▦ Grid" />
            <ViewButton mode="compact" current={view} onClick={persistView} label="≡ Compact" />
            <ViewButton mode="list" current={view} onClick={persistView} label="☰ List" />
          </div>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          {sorted.length} of {papers.length} match{papers.length === 1 ? "es" : ""} this filter.
        </p>
      </div>

      {/* Render based on view mode */}
      {sorted.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
          No papers match. Clear the search or change the filter.
        </p>
      ) : view === "grid" ? (
        <GridView papers={sorted} />
      ) : view === "compact" ? (
        <CompactView papers={sorted} />
      ) : (
        <ListView papers={sorted} />
      )}
    </div>
  );
}

function ViewButton({ mode, current, onClick, label }: {
  mode: ViewMode; current: ViewMode; onClick: (m: ViewMode) => void; label: string;
}) {
  const active = current === mode;
  return (
    <button
      onClick={() => onClick(mode)}
      className={`rounded px-2.5 py-1 transition ${
        active ? "bg-emerald-950/40 text-emerald-300" : "text-zinc-400 hover:text-zinc-200"
      }`}
      title={mode}
    >
      {label}
    </button>
  );
}

/** Boxed 3-col grid. Each tile shows title + journal + year + quality + strength. */
function GridView({ papers }: { papers: PaperRow[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {papers.map((p) => (
        <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 transition hover:border-emerald-500">
          <Link href={`/research/${p.id}`} className="block">
            <div className="flex flex-wrap items-baseline gap-2 text-[10px]">
              {p.publication_year != null && <span className="font-mono text-zinc-500">{p.publication_year}</span>}
              {p.study_type && (
                <span className="rounded bg-zinc-900 px-1 py-0.5 uppercase tracking-wider text-zinc-400">
                  {STUDY_TYPE_LABEL[p.study_type] ?? p.study_type}
                </span>
              )}
              {p.retracted && <span className="rounded bg-red-700 px-1 py-0.5 font-bold uppercase text-white">retracted</span>}
            </div>
            <h2 className="mt-1.5 text-[13px] font-semibold leading-snug text-zinc-100 line-clamp-3">
              {p.title}
            </h2>
            {p.journal && (
              <p className="mt-1 text-[10px] text-zinc-500 line-clamp-1">{p.journal}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              {p.ai_methodology_quality != null && (
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                  Q <span className="font-bold">{p.ai_methodology_quality}/5</span>
                </span>
              )}
              {p.ai_evidence_strength && (
                <span className={`rounded border px-1.5 py-0.5 font-bold uppercase ${STRENGTH_COLORS[p.ai_evidence_strength] ?? ""}`}>
                  {p.ai_evidence_strength}
                </span>
              )}
              {p.ai_distinguishes_natural_vs_synthetic && (
                <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-300" title="Distinguishes natural-leaf from 7-OH / synthetic">
                  ⚙
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Compact 2-col mini-rows. Minimal info per tile, dense scan-read. */
function CompactView({ papers }: { papers: PaperRow[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {papers.map((p) => (
        <li key={p.id}>
          <Link
            href={`/research/${p.id}`}
            className="flex items-baseline gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[12px] transition hover:border-emerald-500"
          >
            <span className="font-mono text-[10px] text-zinc-500 w-10 shrink-0">
              {p.publication_year ?? "—"}
            </span>
            <span className="flex-1 text-zinc-100 line-clamp-2 leading-snug">
              {p.title}
            </span>
            {p.ai_methodology_quality != null && (
              <span className="text-[10px] text-zinc-400 shrink-0">
                Q<span className="font-bold text-zinc-200">{p.ai_methodology_quality}</span>
              </span>
            )}
            {p.ai_evidence_strength && (
              <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${STRENGTH_COLORS[p.ai_evidence_strength] ?? ""}`}>
                {p.ai_evidence_strength.slice(0, 4)}
              </span>
            )}
            {p.retracted && (
              <span className="shrink-0 rounded bg-red-700 px-1 py-0.5 text-[9px] font-bold uppercase text-white">!</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Full-detail list view — original layout, kept for users who want
    abstract + author + key findings inline. */
function ListView({ papers }: { papers: PaperRow[] }) {
  return (
    <ul className="space-y-3">
      {papers.map((p) => (
        <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
            {p.publication_year != null && <span className="font-mono text-zinc-500">{p.publication_year}</span>}
            {p.journal && <span className="text-zinc-400">{p.journal.slice(0, 60)}</span>}
            {p.study_type && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 uppercase tracking-wider text-zinc-400">
                {STUDY_TYPE_LABEL[p.study_type] ?? p.study_type}
              </span>
            )}
            {p.ai_methodology_quality != null && (
              <span className="text-zinc-500">
                methodology <span className="font-bold text-zinc-200">{p.ai_methodology_quality}/5</span>
              </span>
            )}
            {p.ai_evidence_strength && (
              <span className={`rounded border px-1.5 py-0.5 font-bold uppercase ${STRENGTH_COLORS[p.ai_evidence_strength] ?? ""}`}>
                {p.ai_evidence_strength}
              </span>
            )}
            {p.ai_distinguishes_natural_vs_synthetic && (
              <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-white" title="Distinguishes natural-leaf from 7-OH / synthetic">
                ⚙ distinguishes leaf vs 7-OH
              </span>
            )}
            {p.retracted && (
              <span className="rounded bg-red-700 px-1.5 py-0.5 font-bold uppercase text-white">RETRACTED</span>
            )}
          </div>
          <h2 className="mt-1 text-sm font-semibold leading-tight text-zinc-100">
            <Link href={`/research/${p.id}`} className="hover:text-emerald-400">
              {p.title}
            </Link>
          </h2>
          {p.authors && p.authors.length > 0 && (
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {p.authors.slice(0, 4).join(", ")}{p.authors.length > 4 ? ` +${p.authors.length - 4} more` : ""}
            </p>
          )}
          {p.ai_key_findings_md && (
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              {p.ai_key_findings_md.slice(0, 280)}{p.ai_key_findings_md.length > 280 ? "…" : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
