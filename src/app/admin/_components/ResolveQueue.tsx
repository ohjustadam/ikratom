"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeCampaignQueue, applyCampaignQueuePlan,
  analyzeIntelQueue, applyIntelQueuePlan, autoResolveQueue,
} from "@/modules/admin/queue-resolve-actions";
import type { Decision, PlanItem, ProposedAction, QueueKind } from "@/modules/admin/queue-resolve-types";

const ACTIONS: ProposedAction[] = ["approve", "reject", "supersede", "keep"];
const CONF: Record<PlanItem["confidence"], string> = { high: "text-emerald-400", medium: "text-amber-400", low: "text-zinc-500" };

/**
 * Queue resolver. Primary action = one-click FULL AUTO (analyze + apply every
 * confident decision, no per-item review). Secondary = "Review each first" opens
 * the preview panel for manual control. Used on both admin queue pages and the
 * unified /admin/moderation panel.
 */
export default function ResolveQueue({ kind, compact = false }: { kind: QueueKind; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [working, startWork] = useTransition();

  const analyze = kind === "campaigns" ? analyzeCampaignQueue : analyzeIntelQueue;
  const applyPlan = kind === "campaigns" ? applyCampaignQueuePlan : applyIntelQueuePlan;
  const label = kind === "campaigns" ? "campaign reviews" : "intel queue";

  function autoResolve() {
    if (!confirm(`Auto-resolve the ${label} now?\n\nEvery item is decided automatically — approvals notify users and can't be recalled. Uncertain items are safely rejected. Nothing is left for you to review.`)) return;
    setMsg(null);
    startWork(async () => {
      const r = await autoResolveQueue(kind);
      if (!r.ok) { setMsg(r.error); return; }
      setMsg(`Done — ${r.approved} approved, ${r.rejected} rejected${r.superseded ? `, ${r.superseded} superseded` : ""}.`);
      router.refresh();
    });
  }

  function openReview() {
    setOpen(true); setItems(null); setMsg(null);
    startAnalyze(async () => {
      const r = await analyze();
      if (!r.ok) { setItems([]); setMsg(r.error); return; }
      setItems(r.items);
      if (!r.items.length) setMsg("Queue is empty — nothing to resolve.");
    });
  }
  function setAction(id: string, action: ProposedAction) {
    setItems((prev) => (prev ? prev.map((i) => (i.id === id ? { ...i, action } : i)) : prev));
  }
  function applyAll() {
    if (!items) return;
    const decisions: Decision[] = items.filter((i) => i.action !== "keep").map((i) => ({ id: i.id, action: i.action, reason: i.reason }));
    if (!decisions.length) { setMsg("No changes selected."); return; }
    startWork(async () => {
      const r = await applyPlan(decisions);
      if (!r.ok) { setMsg(r.error); return; }
      setMsg(`Applied — ${r.approved} approved, ${r.rejected} rejected${r.superseded ? `, ${r.superseded} superseded` : ""}.`);
      router.refresh();
      setTimeout(() => setOpen(false), 1400);
    });
  }

  const counts = (items ?? []).reduce<Record<string, number>>((a, i) => ({ ...a, [i.action]: (a[i.action] ?? 0) + 1 }), {});

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={autoResolve} disabled={working} className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
          {working ? "Resolving…" : "✨ Auto-resolve all"}
        </button>
        <button onClick={openReview} className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500">Review each first</button>
      </div>
      {!compact && msg && <p className="mt-1 text-[11px] text-zinc-400">{msg}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
          <div className="mt-8 w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Review {label}</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">✕</button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Web fact-checked proposals (free-tier AI). Adjust any row, then apply. Approvals notify users.</p>
            {analyzing && <p className="py-10 text-center text-sm text-zinc-400">Analyzing + fact-checking…</p>}
            {items && items.length > 0 && (
              <>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <span className="text-emerald-400">{counts.approve ?? 0} approve</span>
                  <span className="text-red-400">{counts.reject ?? 0} reject</span>
                  <span className="text-amber-400">{counts.supersede ?? 0} supersede</span>
                  <span className="text-zinc-500">{counts.keep ?? 0} keep</span>
                </div>
                <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                  {items.map((i) => (
                    <div key={i.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-200">{i.title}</p>
                          <p className="text-[11px] text-zinc-500">{i.subtitle} · <span className={CONF[i.confidence]}>{i.confidence} confidence</span></p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">{i.reason}</p>
                        </div>
                        <select value={i.action} onChange={(e) => setAction(i.id, e.target.value as ProposedAction)} className="shrink-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200">
                          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400">{msg}</span>
                  <button onClick={applyAll} disabled={working} className="shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">{working ? "Applying…" : "Apply all"}</button>
                </div>
              </>
            )}
            {items && items.length === 0 && <p className="py-10 text-center text-sm text-zinc-400">{msg ?? "Nothing to resolve."}</p>}
          </div>
        </div>
      )}
    </>
  );
}
