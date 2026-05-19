"use client";

import { useMemo, useState } from "react";
import { TYPE_ICONS, TYPE_LABELS, type LibraryItemType } from "@/modules/library/types";

type Item = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  author: string | null;
  source_org: string | null;
  duration_seconds: number | null;
  tags: string[];
  featured: boolean;
  published_at: string | null;
};

const TYPES: LibraryItemType[] = ["video", "audio", "book", "article", "document"];

export function LibraryBrowser({ items }: { items: Item[] }) {
  const [type, setType] = useState<LibraryItemType | "all">("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.type] = (c[i.type] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (type !== "all" && i.type !== type) return false;
      if (q) {
        const hay = `${i.title} ${i.description ?? ""} ${i.author ?? ""} ${i.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, type, query]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-3xl">📚</p>
        <h2 className="mt-3 text-lg font-semibold">The library is just getting started</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
          Videos explaining kratom science and policy, books by advocates, podcasts, and
          court-case documents. As we add them, this becomes the canonical reference for the community.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">▶️ Videos</span>
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">🎙️ Podcasts</span>
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">📖 Books</span>
          <span className="rounded bg-zinc-900 px-2 py-1 text-zinc-400">📰 Articles</span>
        </div>
        <p className="mt-5 text-xs text-zinc-500">
          Advocate leaders + admins can seed the first items via the button above.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, author, tags…"
          className="flex-1 min-w-[220px] rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Pill active={type === "all"} onClick={() => setType("all")} count={counts.all}>
          All
        </Pill>
        {TYPES.map((t) => (
          <Pill key={t} active={type === t} onClick={() => setType(t)} count={counts[t] ?? 0}>
            {TYPE_ICONS[t]} {TYPE_LABELS[t]}
          </Pill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">No items match.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((i) => (
            <li key={i.id}>
              <a
                href={`/library/${i.id}`}
                className={`block h-full overflow-hidden rounded-lg border transition ${
                  i.featured
                    ? "border-emerald-700/50 bg-emerald-950/10 hover:border-emerald-500"
                    : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                }`}
              >
                {i.cover_image_url && (
                  <div className="aspect-video w-full overflow-hidden bg-zinc-900">
                    <img src={i.cover_image_url} alt={i.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500">
                      {TYPE_ICONS[i.type as LibraryItemType] ?? "•"} {TYPE_LABELS[i.type as LibraryItemType] ?? i.type}
                    </span>
                    {i.duration_seconds && (
                      <span className="text-zinc-600">· {fmtDuration(i.duration_seconds)}</span>
                    )}
                    {i.featured && (
                      <span className="ml-auto rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                        ★
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 font-semibold leading-tight">{i.title}</h3>
                  {i.description && (
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-400">{i.description}</p>
                  )}
                  {(i.author || i.source_org) && (
                    <p className="mt-2 text-xs text-zinc-500">
                      {[i.author, i.source_org].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {i.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {i.tags.slice(0, 4).map((t) => (
                        <span key={t} className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pill({ active, onClick, count, children }: {
  active: boolean; onClick: () => void; count: number; children: React.ReactNode;
}) {
  return (
    <button
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

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
