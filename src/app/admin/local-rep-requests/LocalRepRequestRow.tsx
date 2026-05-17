"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  previewSuggestions,
  acceptSelectedOfficials,
  type SuggestionWithTier,
} from "@/modules/admin/local-rep-inline-actions";

/**
 * Single row on /admin/local-rep-requests. Click "AI suggest" → expands
 * an inline panel with the suggested officials + per-official Accept
 * checkboxes. No page reroute, no context loss. Multiple rows can be
 * expanded simultaneously.
 */
export function LocalRepRequestRow({
  request,
  rejectButton,
}: {
  request: {
    state: string;
    locality: string;
    level: "municipal" | "county";
    user_count: number;
  };
  /** Server-rendered Reject button slot. Lets us keep server actions
   *  in a server component while the row itself is client-side. */
  rejectButton?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ officials: SuggestionWithTier[]; sources: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, startSaving] = useTransition();
  const [result, setResult] = useState<{ inserted: number; alreadyExisted: number } | null>(null);

  async function onToggle() {
    setOpen((prev) => !prev);
    if (!data && !loading && !open) {
      setLoading(true);
      setError(null);
      const r = await previewSuggestions({
        state: request.state,
        locality: request.locality,
        level: request.level,
      });
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setData({ officials: r.officials, sources: r.sources });
      // Pre-tick all non-rejected, non-dupe officials
      const initial = new Set<string>();
      for (const o of r.officials) {
        if (o.tier !== "rejected" && !o.already_exists) initial.add(o.full_name);
      }
      setPicked(initial);
    }
  }

  function togglePick(name: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function onSave() {
    if (!data) return;
    const selected = data.officials.filter((o) => picked.has(o.full_name) && !o.already_exists);
    if (selected.length === 0) {
      setError("Pick at least one official to accept.");
      return;
    }
    startSaving(async () => {
      const r = await acceptSelectedOfficials({
        state: request.state,
        locality: request.locality,
        level: request.level,
        officials: selected,
        sources: data.sources,
      });
      if (r.ok) {
        setResult({ inserted: r.inserted, alreadyExisted: r.alreadyExisted });
        setTimeout(() => router.refresh(), 1200);
      } else {
        setError(r.error);
      }
    });
  }

  const tierBadge = (tier: SuggestionWithTier["tier"]) => {
    if (tier === "verified") return <span className="rounded bg-emerald-700/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">VERIFIED</span>;
    if (tier === "tentative") return <span className="rounded bg-amber-700/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">TENTATIVE</span>;
    return <span className="rounded bg-red-700/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-200">REJECTED</span>;
  };

  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-950/40">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
          {request.state}
        </span>
        <span className="font-semibold text-zinc-100">{request.locality}</span>
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
          {request.level}
        </span>
        <span className="text-xs text-zinc-500">
          {request.user_count} {request.user_count === 1 ? "user waiting" : "users waiting"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
          >
            {open ? "▴ Hide" : data ? "▾ Show suggestions" : "🤖 AI suggest"}
          </button>
          {rejectButton}
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-800 bg-zinc-950/60 p-4">
          {loading && (
            <p className="text-sm text-zinc-400">
              <span className="animate-pulse">🔎 Searching for officials in {request.locality}…</span>
            </p>
          )}
          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {result && (
            <p className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">
              ✓ Inserted {result.inserted}{result.alreadyExisted > 0 ? `, skipped ${result.alreadyExisted} already-existing` : ""}. Refreshing list…
            </p>
          )}
          {data && !result && (
            <>
              {data.officials.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  No officials returned by AI. The locality may have limited web presence.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-zinc-500">
                    {data.officials.length} suggested. <strong className="text-emerald-300">VERIFIED</strong> = name found on cited source page. <strong className="text-amber-300">TENTATIVE</strong> = government-credible domain but couldn&apos;t strict-match (spot-check by clicking the source link). <strong className="text-red-300">REJECTED</strong> = source URL failed; don&apos;t trust without manual confirmation.
                  </p>
                  <table className="w-full text-xs">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="px-2 py-1 text-left">Accept</th>
                        <th className="px-2 py-1 text-left">Tier</th>
                        <th className="px-2 py-1 text-left">Name</th>
                        <th className="px-2 py-1 text-left">Title</th>
                        <th className="px-2 py-1 text-left">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.officials.map((o) => {
                        const disabled = o.tier === "rejected" || o.already_exists;
                        return (
                          <tr key={o.full_name} className={`border-t border-zinc-800 ${disabled ? "opacity-50" : ""}`}>
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={picked.has(o.full_name)}
                                disabled={disabled}
                                onChange={() => togglePick(o.full_name)}
                                className="h-4 w-4"
                              />
                            </td>
                            <td className="px-2 py-2">{tierBadge(o.tier)}</td>
                            <td className="px-2 py-2 text-zinc-200">
                              {o.full_name}
                              {o.already_exists && (
                                <span className="ml-2 text-[10px] text-zinc-500">(already in DB)</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-zinc-400">
                              {o.title ?? o.role}
                              {o.district ? <span className="text-zinc-500"> · D{o.district}</span> : null}
                            </td>
                            <td className="px-2 py-2 max-w-[260px]">
                              {o.source_url ? (
                                <a
                                  href={o.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block truncate text-emerald-400 hover:underline"
                                  title={o.source_url}
                                >
                                  {o.source_url}
                                </a>
                              ) : (
                                <span className="text-zinc-500">—</span>
                              )}
                              <p className="mt-0.5 truncate text-[10px] text-zinc-500" title={o.verifier_note}>
                                {o.verifier_note}
                              </p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onSave}
                      disabled={saving || picked.size === 0}
                      className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : `Accept ${picked.size} →`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPicked(new Set())}
                      disabled={saving || picked.size === 0}
                      className="text-xs text-zinc-400 hover:text-emerald-400"
                    >
                      Clear
                    </button>
                    <span className="ml-auto text-[10px] text-zinc-600">
                      {data.sources.length} AI source{data.sources.length === 1 ? "" : "s"} cited
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
