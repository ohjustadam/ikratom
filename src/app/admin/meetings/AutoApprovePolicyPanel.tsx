"use client";

import { useState, useTransition } from "react";
import { setMeetingAutoApprovePolicy, type MeetingAutoApprovePolicy } from "@/modules/admin/meetings-actions";

/**
 * Compact admin control for the meeting auto-approval policy. Lets the
 * owner make high-confidence AI-extracted meetings hit /calendar without
 * a manual click, while keeping low-confidence ones gated for review.
 */
export function AutoApprovePolicyPanel({ initial }: { initial: MeetingAutoApprovePolicy }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [minConfidence, setMinConfidence] = useState(initial.minConfidence);
  const [requireSource, setRequireSource] = useState(initial.requireSource);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const r = await setMeetingAutoApprovePolicy({ enabled, minConfidence, requireSource });
      if (r && "error" in r && r.error) setError(r.error);
      else setSaved(true);
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
          🤖 Auto-approval policy
        </h2>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${enabled ? "bg-emerald-950/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
          {enabled ? "On" : "Off"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        When on, AI-discovered meetings at or above the confidence threshold (and with a source link, if required)
        are approved automatically each hour — they hit /calendar and fire reminders without a manual click.
        Everything below the bar stays in the review queue. Every auto-approval is logged to the audit trail.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
          Enabled
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <span>Min confidence: <strong className="text-zinc-200">{minConfidence.toFixed(2)}</strong></span>
          <input
            type="range" min={0.5} max={1} step={0.05}
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="w-40 accent-emerald-500"
          />
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input type="checkbox" checked={requireSource} onChange={(e) => setRequireSource(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
          Require source link
        </label>

        <button
          onClick={save}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save policy"}
        </button>
        {saved && <span className="text-[11px] text-emerald-400">✓ Saved</span>}
        {error && <span className="text-[11px] text-red-400">{error}</span>}
      </div>
    </section>
  );
}
