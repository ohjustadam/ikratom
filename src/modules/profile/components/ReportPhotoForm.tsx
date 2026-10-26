"use client";

import { useState, useTransition } from "react";
import { reportPhoto } from "../photo-actions";

const REASONS = [
  { id: "personal_info", label: "Shows someone's personal info or location" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "nudity", label: "Nudity or sexual content" },
  { id: "violence", label: "Violence or threats" },
  { id: "spam", label: "Spam or scam" },
  { id: "other", label: "Something else" },
] as const;

/** Report button → reason picker. Feeds /admin/moderation/photos. */
export function ReportPhotoForm({ photoId }: { photoId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("personal_info");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (msg) return <span role="status" className="text-xs text-emerald-400">{msg}</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-zinc-400 underline hover:text-red-400">
        Report
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await reportPhoto(photoId, reason, note);
          setMsg("error" in r ? r.error : "Thanks. A moderator will review it.");
        });
      }}
      className="flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-3 text-xs"
    >
      <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
        {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Anything we should know? (optional)"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-red-600 px-3 py-1 font-semibold text-white disabled:opacity-50">Send report</button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-zinc-400">Cancel</button>
      </div>
    </form>
  );
}
