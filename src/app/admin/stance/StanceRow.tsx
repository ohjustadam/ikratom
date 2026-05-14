"use client";

import { useState, useTransition } from "react";
import { setStance } from "@/modules/admin/stance-actions";

const STANCES = ["champion", "sympathetic", "neutral", "hostile", "unknown"] as const;
const COLORS: Record<string, string> = {
  champion: "bg-emerald-600 text-white",
  sympathetic: "bg-emerald-950/40 text-emerald-300",
  neutral: "bg-zinc-800 text-zinc-300",
  hostile: "bg-red-900/60 text-red-200",
  unknown: "bg-zinc-900 text-zinc-500",
};

export function StanceRow({
  legId,
  legName,
  role,
  district,
  initial,
}: {
  legId: string;
  legName: string;
  role: string | null;
  district: string | null;
  initial: { stance: string; rationale_md: string | null; last_evidence_url: string | null; last_updated_at: string | null } | null;
}) {
  const [stance, setLocalStance] = useState<string>(initial?.stance ?? "unknown");
  const [rationale, setRationale] = useState<string>(initial?.rationale_md ?? "");
  const [evidence, setEvidence] = useState<string>(initial?.last_evidence_url ?? "");
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = (newStance?: string) => {
    const finalStance = newStance ?? stance;
    startTransition(async () => {
      const r = await setStance({
        legislatorId: legId,
        stance: finalStance,
        rationale_md: rationale || null,
        last_evidence_url: evidence || null,
      });
      if ("error" in r) {
        setErr(r.error ?? "Unknown error");
      } else {
        setSavedAt(new Date().toLocaleTimeString());
        setErr(null);
      }
    });
  };

  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold text-zinc-100">{legName}</span>
        {role && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{role}</span>}
        {district && <span className="text-[11px] text-zinc-500">district {district}</span>}
        <a
          href={`/legislators/${legId}/briefing`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
          title="Open public briefing in new tab — what the user sees"
        >
          ◉ Preview brief ↗
        </a>
        <span className="ml-auto flex flex-wrap gap-1">
          {STANCES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => { setLocalStance(s); save(s); }}
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                stance === s ? COLORS[s] : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              } ${pending ? "opacity-50" : ""}`}
            >
              {s}
            </button>
          ))}
        </span>
      </div>
      {savedAt && <p className="mt-1 text-[10px] text-emerald-400">✓ saved {savedAt}</p>}
      {err && <p className="mt-1 text-[10px] text-red-400">✗ {err}</p>}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-1 text-[11px] text-zinc-400 hover:text-emerald-400"
      >
        {expanded ? "▾ hide rationale" : "▸ edit rationale"} {initial?.rationale_md ? "" : "(blank)"}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Rationale (markdown). Cite bills, statements, committee role."
            className="block w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs"
            rows={4}
          />
          <input
            type="url"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Evidence URL (bill page / news article / official statement)"
            className="block w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => save()}
            disabled={pending}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-50"
          >
            Save rationale
          </button>
        </div>
      )}
    </li>
  );
}
