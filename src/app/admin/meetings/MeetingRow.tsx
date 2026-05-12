"use client";

import { useState, useTransition } from "react";
import { setMeetingStatus, broadcastMeeting } from "@/modules/admin/meetings-actions";

export function MeetingRow({ m }: { m: {
  id: string;
  state: string;
  locality: string | null;
  body_name: string | null;
  meeting_at: string;
  format: string;
  zoom_url: string | null;
  livestream_url: string | null;
  agenda_url: string | null;
  agenda_text: string | null;
  source_url: string | null;
  ai_confidence: number | null;
  discovered_via: string;
  moderation_status: string;
  broadcast_at?: string | null;
  broadcast_recipient_count?: number | null;
} }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(m.moderation_status);
  const [broadcastAt, setBroadcastAt] = useState<string | null>(m.broadcast_at ?? null);
  const [broadcastCount, setBroadcastCount] = useState<number | null>(m.broadcast_recipient_count ?? null);
  const [err, setErr] = useState<string | null>(null);

  const flip = (next: "approved" | "rejected" | "archived") => {
    startTransition(async () => {
      const r = await setMeetingStatus({ id: m.id, status: next });
      if ("error" in r) {
        setErr(r.error ?? "Update failed");
      } else {
        setStatus(next);
        setErr(null);
      }
    });
  };

  const broadcast = () => {
    const label = `${m.locality ?? m.state}`;
    if (!confirm(`📢 Broadcast "${label}" as LIVE NOW to all users in ${m.state}?\n\nThis sends a push notification + creates a critical /pulse alert with the Zoom link. Irreversible.`)) return;
    startTransition(async () => {
      const r = await broadcastMeeting({ id: m.id });
      if ("error" in r) {
        setErr(r.error ?? "Broadcast failed");
      } else if ("already" in r && r.already) {
        setErr(`Already broadcast at ${r.broadcast_at?.slice(0, 16)} to ${r.recipient_count} user(s)`);
      } else if ("user_count" in r) {
        setBroadcastAt(new Date().toISOString());
        setBroadcastCount(r.user_count ?? 0);
        setErr(null);
      }
    });
  };

  const when = new Date(m.meeting_at);
  const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);

  return (
    <li className={`rounded-md border p-3 ${
      status === "approved" ? "border-emerald-700/40 bg-emerald-950/15" :
      status === "rejected" ? "border-zinc-800 bg-zinc-950/40 opacity-60" :
      "border-amber-700/40 bg-amber-950/15"
    }`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300">
          {m.state}
        </span>
        <span className="text-[10px] font-bold uppercase text-zinc-500">
          in {days}d
        </span>
        <span className="text-sm font-semibold text-zinc-100">
          {m.locality ?? "?"}{m.body_name ? ` · ${m.body_name}` : ""}
        </span>
        <span className="text-[11px] text-zinc-500">
          {when.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
        {m.ai_confidence != null && (
          <span className="text-[10px] text-zinc-500">conf {Math.round(m.ai_confidence * 100)}%</span>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          {status === "approved" && !broadcastAt && (
            <button type="button" disabled={pending} onClick={broadcast}
              className="rounded px-2 py-0.5 text-[10px] font-bold uppercase bg-red-600 text-white hover:bg-red-500 animate-pulse">
              📢 Broadcast NOW
            </button>
          )}
          {broadcastAt && (
            <span className="rounded bg-red-900/40 px-2 py-0.5 text-[10px] font-bold uppercase text-red-300">
              📢 sent · {broadcastCount ?? 0} users
            </span>
          )}
          <button type="button" disabled={pending} onClick={() => flip("approved")}
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${status === "approved" ? "bg-emerald-600 text-zinc-950" : "bg-zinc-900 text-zinc-400 hover:text-emerald-400"}`}>
            approve
          </button>
          <button type="button" disabled={pending} onClick={() => flip("rejected")}
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${status === "rejected" ? "bg-red-900 text-white" : "bg-zinc-900 text-zinc-400 hover:text-red-400"}`}>
            reject
          </button>
          <button type="button" disabled={pending} onClick={() => flip("archived")}
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase bg-zinc-900 text-zinc-500 hover:text-zinc-300">
            archive
          </button>
        </span>
      </div>
      {m.agenda_text && (
        <p className="mt-1 text-xs italic text-zinc-400">
          &ldquo;{m.agenda_text.slice(0, 250)}{m.agenda_text.length > 250 ? "…" : ""}&rdquo;
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {m.zoom_url && <a href={m.zoom_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Zoom ↗</a>}
        {m.livestream_url && <a href={m.livestream_url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">Livestream ↗</a>}
        {m.agenda_url && <a href={m.agenda_url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-emerald-400">Agenda ↗</a>}
        {m.source_url && <a href={m.source_url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400">Source ↗</a>}
        <span className="ml-auto text-zinc-600">via {m.discovered_via}</span>
      </div>
      {err && <p className="mt-1 text-[10px] text-red-400">✗ {err}</p>}
    </li>
  );
}
