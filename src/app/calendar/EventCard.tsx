import Link from "next/link";
import { KIND_BADGE, type CalendarEvent } from "./types";

/** One event row — shared by the day-grouped list and the month-view day detail. */
export function EventCard({ e }: { e: CalendarEvent }) {
  const meta = KIND_BADGE[e.kind];
  return (
    <li className={`rounded-md border p-3 ${
      e.severity === "critical" ? "border-red-700/50 bg-red-950/10" : "border-zinc-800 bg-zinc-950/40"
    }`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.cls}`}>
          {meta.emoji} {meta.label}
        </span>
        {e.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">{e.state}</span>}
        <span className="text-[11px] text-zinc-500">
          {e.allDay
            ? "All day"
            : e.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        {e.severity === "critical" && <span className="text-[10px] font-bold uppercase text-red-400 animate-pulse">CRITICAL</span>}
      </div>
      <h3 className="mt-1 text-sm font-semibold text-zinc-100">{e.title}</h3>
      {e.body && (
        <p className="mt-1 line-clamp-3 text-xs text-zinc-400">{e.body}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {e.zoom_url && (
          <a href={e.zoom_url} target="_blank" rel="noopener noreferrer"
            className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-zinc-950 hover:bg-emerald-500">
            📹 Join Zoom
          </a>
        )}
        {e.livestream_url && (
          <a href={e.livestream_url} target="_blank" rel="noopener noreferrer"
            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
            📺 Livestream
          </a>
        )}
        {e.public_comment_url && (
          <a href={e.public_comment_url} target="_blank" rel="noopener noreferrer"
            className="rounded border border-amber-700/60 bg-amber-950/30 px-2.5 py-1 text-amber-200 hover:border-amber-500">
            🎤 Sign up to speak
          </a>
        )}
        {e.agenda_url && (
          <a href={e.agenda_url} target="_blank" rel="noopener noreferrer"
            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
            📄 Agenda
          </a>
        )}
        {e.in_person_address && (
          <span className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-400">
            📍 {e.in_person_address.slice(0, 80)}
          </span>
        )}
        {e.detail_href && (
          <Link href={e.detail_href} className="rounded border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1 font-semibold text-emerald-300 hover:border-emerald-500">
            {e.kind === "bill_action" || e.kind === "bill_effective" ? "📜 View bill" :
             e.kind === "alert" ? "🔗 Open alert" :
             e.kind === "municipal" ? "🏛️ Meeting detail" :
             e.kind === "townhall" ? "👤 Legislator" :
             e.kind === "state_session" ? "📍 State hub" : "detail →"}
          </Link>
        )}
        {e.bill_href && (
          <Link href={e.bill_href} className="rounded border border-blue-700/40 bg-blue-950/20 px-2.5 py-1 font-semibold text-blue-300 hover:border-blue-500">
            📜 Related bill
          </Link>
        )}
        {e.source_url && !e.detail_href && (
          <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400">
            source ↗
          </a>
        )}
      </div>
    </li>
  );
}
