"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";
import { StanceChips, roleMeta, displayRole, orderedDisplayRoles, type StanceValue } from "@/lib/stakeholder-stance";

type Row = {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  role_type: string;
  reasoning: string;
  leaf_stance: string | null;
  seven_oh_stance: string | null;
  leaf_evidence_url: string | null;
  seven_oh_evidence_url: string | null;
  stance_summary: string | null;
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

// Neutral stance filters (facts, not ally/opponent). Value = "axis:stance".
const STANCE_FILTERS: { value: string; label: string }[] = [
  { value: "leaf:supportive", label: "🌿 Supports leaf" },
  { value: "leaf:restrictive", label: "🌿 Restricts leaf" },
  { value: "seven_oh:supportive", label: "⚗️ Supports 7-OH" },
  { value: "seven_oh:restrictive", label: "⚗️ Restricts 7-OH" },
];

export function PeopleBrowser({ rows }: { rows: Row[] }) {
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [stanceFilter, setStanceFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const statesPresent = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.bill?.state).filter(Boolean) as string[])).sort();
  }, [rows]);

  // Count by NEUTRAL display role (ally/opponent collapse into "policy").
  const rolesPresent = useMemo(() => orderedDisplayRoles(rows.map(r => r.role_type)), [rows]);
  const roleCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) { const dr = displayRole(r.role_type); c[dr] = (c[dr] ?? 0) + 1; }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const [stanceAxis, stanceVal] = stanceFilter !== "all" ? stanceFilter.split(":") : [null, null];
    return rows.filter(r => {
      if (roleFilter !== "all" && displayRole(r.role_type) !== roleFilter) return false;
      if (stateFilter !== "all" && r.bill?.state !== stateFilter) return false;
      if (stanceAxis) {
        const v = stanceAxis === "leaf" ? r.leaf_stance : r.seven_oh_stance;
        if (v !== stanceVal) return false;
      }
      if (q) {
        const hay = `${r.name} ${r.title ?? ""} ${r.organization ?? ""} ${r.reasoning ?? ""} ${r.stance_summary ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, roleFilter, stateFilter, stanceFilter, query]);

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
        <select
          value={stanceFilter}
          onChange={(e) => setStanceFilter(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          aria-label="Filter by documented position"
        >
          <option value="all">Any position</option>
          {STANCE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {/* Role chips — neutral functions only (ally/opponent collapse to "Policy figure") */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        <Chip active={roleFilter === "all"} onClick={() => setRoleFilter("all")} count={roleCounts.all}>
          All
        </Chip>
        {rolesPresent.map((role) => {
          const n = roleCounts[role] ?? 0;
          if (n === 0) return null;
          const meta = roleMeta(role);
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
            const meta = roleMeta(r.role_type);
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
                <StanceChips
                  leafStance={r.leaf_stance as StanceValue}
                  sevenOhStance={r.seven_oh_stance as StanceValue}
                  leafUrl={r.leaf_evidence_url}
                  sevenOhUrl={r.seven_oh_evidence_url}
                  summary={r.stance_summary}
                />
                <p className="mt-2 text-[11px] uppercase tracking-wider text-zinc-500">Why they&apos;re relevant</p>
                <p className="text-[12px] leading-relaxed text-zinc-300">{r.reasoning}</p>
                {(r.email || r.phone || r.website || r.twitter_handle || r.linkedin_url) && (
                  <p className="mt-2 flex flex-wrap gap-3 text-[11px]">
                    {(r.email || r.website) && (
                      <EmailOfficialButton
                        official={{ id: null, name: r.name, title: r.title, email: r.email, website: r.website }}
                        context={{ kind: "stakeholder", billId: r.bill_id }}
                        source="people_browser"
                        variant="inline"
                        label={r.email ? "email" : "contact"}
                      />
                    )}
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
