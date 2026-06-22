"use client";

import { useState, useMemo } from "react";

export type AdminCampaignRow = {
  id: string;
  slug: string;
  title: string;
  state: string | null;
  active: boolean;
  auto_generated: boolean;
  actionsAll: number;
  actions14d: number;
  score: number;
  tier: "high" | "medium" | "low";
};

type SortKey = "priority" | "actions" | "recent";

const TIER_CLS: Record<string, string> = {
  high: "bg-emerald-950/50 text-emerald-300",
  medium: "bg-amber-950/40 text-amber-300",
  low: "bg-zinc-900 text-zinc-500",
};

export function AdminCampaignTable({ rows }: { rows: AdminCampaignRow[] }) {
  const [sort, setSort] = useState<SortKey>("priority");
  const [activeOnly, setActiveOnly] = useState(true);

  const view = useMemo(() => {
    const f = activeOnly ? rows.filter((r) => r.active) : rows;
    const key = sort === "actions" ? "actionsAll" : sort === "recent" ? "actions14d" : "score";
    return [...f].sort((a, b) => (b[key] as number) - (a[key] as number) || b.score - a.score);
  }, [rows, sort, activeOnly]);

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      className={`cursor-pointer select-none p-3 text-right hover:text-emerald-400 ${sort === k ? "text-emerald-400" : ""}`}
      onClick={() => setSort(k)}
    >
      {children} {sort === k ? "↓" : ""}
    </th>
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-xs text-zinc-400">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
        <span className="text-zinc-600">·</span>
        <span>{view.length} shown · sorted by {sort === "recent" ? "14-day actions" : sort}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="p-3 text-left">State</th>
              <th className="p-3 text-left">Title</th>
              <Th k="priority">Priority</Th>
              <Th k="actions">Actions</Th>
              <Th k="recent">14d</Th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
            {view.map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                <td className="p-3">
                  {c.state ? (
                    <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs">{c.state}</span>
                  ) : (
                    <span className="rounded bg-purple-950/40 px-2 py-0.5 text-xs text-purple-300">Federal</span>
                  )}
                </td>
                <td className="max-w-md truncate p-3">
                  <span
                    title={c.auto_generated ? "Auto-generated" : "Manually authored"}
                    className={`mr-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] ${c.auto_generated ? "bg-sky-950/40 text-sky-300" : "bg-zinc-900 text-zinc-400"}`}
                  >
                    {c.auto_generated ? "🤖" : "👤"}
                  </span>
                  {c.title}
                </td>
                <td className="p-3 text-right">
                  <span className={`rounded px-2 py-0.5 font-mono text-xs ${TIER_CLS[c.tier]}`}>{c.score}</span>
                </td>
                <td className="p-3 text-right font-mono">{c.actionsAll}</td>
                <td className="p-3 text-right font-mono text-zinc-400">{c.actions14d || ""}</td>
                <td className="p-3 text-center">
                  {c.active ? (
                    <span className="rounded bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-300">Active</span>
                  ) : (
                    <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-zinc-500">Archived</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <a href={`/admin/campaigns/${c.id}/edit`} className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:border-emerald-500">
                    Edit
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
