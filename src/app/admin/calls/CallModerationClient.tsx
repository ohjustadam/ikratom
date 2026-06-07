"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCallModeration, type PendingCall } from "@/modules/admin/call-moderation-actions";

const POS_COLORS: Record<string, string> = {
  supportive: "border-emerald-700/40 bg-emerald-950/10 text-emerald-300",
  opposed: "border-red-700/40 bg-red-950/10 text-red-300",
  undecided: "border-amber-700/40 bg-amber-950/10 text-amber-300",
  unclear: "border-zinc-700 bg-zinc-950/40 text-zinc-400",
  not_discussed: "border-zinc-800 bg-zinc-950/40 text-zinc-500",
};

export function CallModerationClient({ pending }: { pending: PendingCall[] }) {
  const router = useRouter();
  const [working, startTransition] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  function act(id: string, action: "approve" | "reject") {
    let note = "";
    if (action === "reject") note = prompt("Optional reason (private, audit-logged):") ?? "";
    setMsg(null);
    startTransition(async () => {
      const r = await setCallModeration({ id, action, note });
      if ("error" in r && r.error) { setMsg(`✗ ${r.error.slice(0, 120)}`); return; }
      setDone((prev) => new Set(prev).add(id));
      setMsg(`✓ ${action === "approve" ? "Approved → published to /calls/board" : "Rejected"}`);
      router.refresh();
      setTimeout(() => setMsg(null), 4000);
    });
  }

  const visible = pending.filter((c) => !done.has(c.id));

  if (visible.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-10 text-center text-sm text-zinc-500">
        <p className="text-3xl">✓</p>
        <p className="mt-2">No calls awaiting review.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {visible.map((c) => {
          const pos = c.legislator_position ?? "unclear";
          return (
            <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-bold text-zinc-100">{c.recipient_name ?? "(legislator)"}</span>
                {c.recipient_role && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{c.recipient_role}</span>}
                {c.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{c.state}</span>}
                <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${POS_COLORS[pos] ?? POS_COLORS.unclear}`}>
                  {pos.replace(/_/g, " ")}
                </span>
                {c.duration_seconds != null && <span className="text-[11px] text-zinc-500">{Math.round(c.duration_seconds / 60)}m</span>}
                <span className="ml-auto text-[10px] text-zinc-600">{(c.started_at ?? "").slice(0, 10)}</span>
              </div>

              {/* What WOULD publish (quote-free). */}
              <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Public summary (this publishes)</p>
                <div className="mt-1 whitespace-pre-wrap rounded border border-emerald-900/40 bg-emerald-950/10 p-2 text-sm text-zinc-300">
                  {c.public_summary_md || <span className="text-zinc-600">— no public summary generated —</span>}
                </div>
              </div>

              {/* Private detail — the moderator's evidence, never published. */}
              <details className="mt-3 text-[12px] text-zinc-400">
                <summary className="cursor-pointer text-zinc-400">Private detail (transcript + quotes — admin only, not published)</summary>
                {c.ai_summary_md && (
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Full AI summary (with quotes)</p>
                    <div className="mt-1 whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950/40 p-2">{c.ai_summary_md}</div>
                  </div>
                )}
                {c.transcript_md && (
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Raw transcript</p>
                    <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950/40 p-2 text-zinc-500">{c.transcript_md}</div>
                  </div>
                )}
                {c.user_notes_md && (
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Caller notes</p>
                    <div className="mt-1 whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950/40 p-2 text-zinc-500">{c.user_notes_md}</div>
                  </div>
                )}
              </details>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => act(c.id, "approve")}
                  disabled={working}
                  className="rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
                >
                  ✓ Approve + publish
                </button>
                <button
                  onClick={() => act(c.id, "reject")}
                  disabled={working}
                  className="rounded-md border border-red-700/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:border-red-500 disabled:opacity-50"
                >
                  ✗ Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {msg && (
        <div className={`fixed left-1/2 top-20 z-40 -translate-x-1/2 rounded-lg border p-3 text-sm font-semibold shadow-2xl ${msg.startsWith("✗") ? "border-red-700/60 bg-red-950/90 text-red-200" : "border-emerald-700/60 bg-emerald-950/90 text-emerald-200"}`}>
          {msg}
        </div>
      )}
    </>
  );
}
