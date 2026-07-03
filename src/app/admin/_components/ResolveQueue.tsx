"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeCampaignQueue,
  applyCampaignQueuePlan,
  analyzeIntelQueue,
  applyIntelQueuePlan,
} from "@/modules/admin/queue-resolve-actions";
import type { Decision, PlanItem, ProposedAction, QueueKind } from "@/modules/admin/queue-resolve-types";

const ACTIONS: ProposedAction[] = ["approve", "reject", "supersede", "keep"];
const CONF: Record<PlanItem["confidence"], string> = { high: "text-emerald-400", medium: "text-amber-400", low: "text-zinc-500" };

/**
 * One-button "Auto-resolve" for a review queue. Opens a preview panel of
 * AI-proposed dispositions (web fact-checked, free-tier), lets the admin adjust
 * any row, then applies. Nothing is written until "Apply". Used on both
 * /admin/campaigns/pending and /admin/intel-queue.
 */
export default function ResolveQueue({ kind }: { kind: QueueKind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [applying, startApply] = useTransition();

  const analyze = kind === "campaigns" ? analyzeCampaignQueue : analyzeIntelQueue;
  const apply = kind === "campaigns" ? applyCampaignQueuePlan : applyIntelQueuePlan;
  const label = kind === "campaigns" ? "campaign reviews" : "intel queue";

  function openPanel() {
    setOpen(true);
    setItems(null);
    setMsg(null);
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
    if (!decisions.length) { setMsg("No changes selected — every row is set to keep."); return; }
    startApply(async () => {
      const r = await apply(decisions);
      if (!r.ok) { setMsg(r.error); return; }
      setMsg(`Applied — ${r.approved} approved, ${r.rejected} rejected${r.superseded ? `, ${r.superseded} superseded` : ""}.`);
      router.refresh();
      setTimeout(() => setOpen(false), 1400);
    });
  }

  const counts = (items ?? []).reduce<Record<string, number>>((a, i) => ({ ...a, [i.action]: (a[i.action] ?? 0) + 1 }), {});

  return (
    <>
      <button onClick={openPanel} className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400">
        ✨ Auto-resolve queue
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
          <div className="mt-8 w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Auto-resolve {label}</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">✕</button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Proposed dispositions are web fact-checked with the free-tier AI router. Review, adjust any row, then apply. Nothing is written until you click Apply — and approvals notify users, exactly like a manual approve.</p>

            {analyzing && <p className="py-10 text-center text-sm text-zinc-400">Analyzing queue + fact-checking…</p>}

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
                  <button onClick={applyAll} disabled={applying} className="shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
                    {applying ? "Applying…" : "Apply all"}
                  </button>
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
