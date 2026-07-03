"use client";

import { useState, useRef, useEffect } from "react";
import { askAdminEditor, executeEditorTool, type EditorProposal } from "@/modules/admin/ai-editor-actions";

type Turn = {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  proposal?: EditorProposal | null;
  // once the owner acts on a proposal:
  outcome?: { ok: boolean; message: string } | null;
  acting?: boolean;
};

const STARTERS = [
  "What's broken or stale right now?",
  "How many campaigns and alerts are waiting for me to review?",
  "Catch up the news + daily sync.",
  "Re-sync Oklahoma's legislators.",
];

export function AdminEditorUI() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setDraft("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setBusy(true);
    const r = await askAdminEditor(q, history);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setTurns((prev) => [...prev, { role: "assistant", content: r.answer, provider: r.provider, proposal: r.proposal, outcome: null }]);
  }

  async function confirm(idx: number) {
    const t = turns[idx];
    if (!t?.proposal || t.acting || t.outcome) return;
    setTurns((prev) => prev.map((x, i) => (i === idx ? { ...x, acting: true } : x)));
    const res = await executeEditorTool(t.proposal.tool, JSON.stringify(t.proposal.args));
    setTurns((prev) => prev.map((x, i) => (i === idx ? { ...x, acting: false, outcome: res } : x)));
  }

  function dismiss(idx: number) {
    setTurns((prev) => prev.map((x, i) => (i === idx ? { ...x, outcome: { ok: false, message: "Dismissed." } } : x)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="min-h-[300px] space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">Try:</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${t.role === "user" ? "bg-emerald-800/40 text-emerald-50" : "bg-zinc-800/70 text-zinc-100"}`}>
              {t.content}
              {t.provider && <span className="mt-1 block text-[10px] text-zinc-500">via {t.provider}</span>}
            </div>
            {t.role === "assistant" && t.proposal && (
              <div className="mt-2 rounded-md border border-amber-700/60 bg-amber-950/20 p-3 text-left">
                <p className="text-xs text-amber-200">⚙ Proposed action: <span className="font-medium">{t.proposal.summary}</span></p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{t.proposal.tool}({JSON.stringify(t.proposal.args)})</p>
                {t.outcome ? (
                  <p className={`mt-2 text-xs ${t.outcome.ok ? "text-emerald-300" : "text-zinc-400"}`}>{t.outcome.ok ? "✓ " : "• "}{t.outcome.message}</p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button disabled={t.acting} onClick={() => confirm(i)} className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                      {t.acting ? "Running…" : "Do it"}
                    </button>
                    <button disabled={t.acting} onClick={() => dismiss(i)} className="rounded bg-zinc-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-600 disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-xs text-zinc-500">Thinking…</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void send(draft); }} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask what's happening, or tell me what to do…"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
        <button type="submit" disabled={busy || !draft.trim()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}
