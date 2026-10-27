"use client";

import { useState, useTransition } from "react";
import { reportContent } from "../actions";
import { NOTE_MAX, REPORT_REASONS, type ReportTarget } from "../types";

/**
 * The ONE report button (migration 0288). Drop it next to anything a member
 * posted:
 *
 *   <ReportButton targetType="lounge_message" targetId={m.id} />
 *
 * `excerpt` turns the note into "paste the message" — for DMs, which are
 * end-to-end encrypted, so the server can never read what was said.
 */
export function ReportButton({
  targetType,
  targetId,
  label = "Report",
  excerpt = false,
  className,
}: {
  targetType: ReportTarget;
  targetId: string;
  label?: string;
  excerpt?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("harassment");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (msg) return <span role="status" className="text-xs text-emerald-400">{msg}</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={className ?? "text-xs text-zinc-500 underline-offset-2 hover:text-red-400 hover:underline"}>
        {label}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await reportContent({ targetType, targetId, reason, note });
          setMsg("error" in r ? r.error : "Thanks. A moderator will review it.");
        });
      }}
      className="flex w-full max-w-sm flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-3 text-left text-xs text-zinc-200"
    >
      <label className="font-semibold" htmlFor={`report-${targetId}`}>What&apos;s wrong?</label>
      <select id={`report-${targetId}`} value={reason} onChange={(e) => setReason(e.target.value)}
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
        {REPORT_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      {excerpt ? (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} rows={3}
          placeholder="Paste the message (optional). Messages are encrypted, so moderators only see what you paste here."
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
      ) : (
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Anything we should know? (optional)"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-red-600 px-3 py-1 font-semibold text-white disabled:opacity-50">
          {pending ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-zinc-400">Cancel</button>
      </div>
    </form>
  );
}
