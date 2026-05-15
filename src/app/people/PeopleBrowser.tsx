"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  role_type: string;
  reasoning: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  twitter_handle: string | null;
  linkedin_url: string | null;
  bill_id: string;
  bill: {
    state: string;
    bill_number: string;
    title: string | null;
    status: string | null;
    kratom_relevance: string | null;
  } | null;
};

const ROLE_META: Record<string, { emoji: string; label: string; cls: string; valueCls: string }> = {
  ally:       { emoji: "🤝", label: "Allies",                    cls: "border-emerald-700/40 bg-emerald-950/15", valueCls: "text-emerald-300" },
  expert:     { emoji: "🎓", label: "Experts",                   cls: "border-sky-700/40 bg-sky-950/15",         valueCls: "text-sky-300" },
  journalist: { emoji: "📰", label: "Journalists",               cls: "border-amber-700/40 bg-amber-950/15",     valueCls: "text-amber-300" },
  opponent:   { emoji: "⚠",  label: "Opponents",                 cls: "border-red-700/40 bg-red-950/15",         valueCls: "text-red-300" },
  affected:   { emoji: "🏪", label: "Affected business",         cls: "border-violet-700/40 bg-violet-950/15",   valueCls: "text-violet-300" },
  community:  { emoji: "🌐", label: "Community / harm-reduction", cls: "border-teal-700/40 bg-teal-950/15",       valueCls: "text-teal-300" },
};

export function PeopleBrowser({ rows }: { rows: Row[] }) {
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const statesPresent = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.bill?.state).filter(Boolean) as string[])).sort();
  }, [rows]);

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.role_type] = (c[r.role_type] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (roleFilter !== "all" && r.role_type !== roleFilter) return false;
      if (stateFilter !== "all" && r.bill?.state !== stateFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.title ?? ""} ${r.organization ?? ""} ${r.reasoning ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, roleFilter, stateFilter, query]);

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, title, organization, reasoning…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        >
          <option value="all">All states ({statesPresent.length})</option>
          {statesPresent.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Role chips */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        <Chip active={roleFilter === "all"} onClick={() => setRoleFilter("all")} count={roleCounts.all}>
          All
        </Chip>
        {Object.entries(ROLE_META).map(([role, meta]) => {
          const n = roleCounts[role] ?? 0;
          if (n === 0) return null;
          return (
            <Chip
              key={role}
              active={roleFilter === role}
              onClick={() => setRoleFilter(role)}
              count={n}
              valueCls={meta.valueCls}
            >
              {meta.emoji} {meta.label}
            </Chip>
          );
        })}
      </div>

      <p className="mb-3 text-xs text-zinc-500">
        {filtered.length} {filtered.length === 1 ? "match" : "matches"}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No matches. Clear filters or try a different search term.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(r => {
            const meta = ROLE_META[r.role_type] ?? { emoji: "·", label: r.role_type, cls: "border-zinc-700 bg-zinc-950/40", valueCls: "text-zinc-300" };
            return (
              <li key={r.id} className={`rounded-md border p-4 ${meta.cls}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.valueCls}`}>
                    {meta.emoji} {meta.label}
                  </span>
                  {r.bill && (
                    <Link
                      href={`/bills/${r.bill_id}`}
                      className="ml-auto rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-emerald-400"
                    >
                      {r.bill.state} {r.bill.bill_number} →
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{r.name}</p>
                {(r.title || r.organization) && (
                  <p className="text-[12px] text-zinc-400">
                    {r.title}{r.title && r.organization ? " · " : ""}{r.organization}
                  </p>
                )}
                <p className="mt-2 text-[12px] leading-relaxed text-zinc-300">{r.reasoning}</p>
                {(r.email || r.phone || r.website || r.twitter_handle || r.linkedin_url) && (
                  <p className="mt-2 flex flex-wrap gap-3 text-[11px]">
                    {r.email && <a href={`mailto:${r.email}`} className="text-emerald-400 hover:underline">📧 {r.email}</a>}
                    {r.phone && <a href={`tel:${r.phone}`} className="text-emerald-400 hover:underline">📞 {r.phone}</a>}
                    {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">🔗 website</a>}
                    {r.twitter_handle && <a href={`https://twitter.com/${r.twitter_handle.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">@{r.twitter_handle.replace(/^@/, "")}</a>}
                    {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">💼 LinkedIn</a>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({
  children, active, onClick, count, valueCls,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  count: number;
  valueCls?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
          : "border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:border-emerald-700"
      }`}
    >
      <span className={valueCls ?? ""}>{children}</span>{" "}
      <span className="text-zinc-500">({count})</span>
    </button>
  );
}
