import Link from "next/link";
import { EventCard } from "./EventCard";
import type { CalendarEvent } from "./types";

/** Day-grouped list view (the default), plus the "nothing matches" state. */
export function EventList({ groups, todayYmd, hasFilters }: {
  groups: Map<string, CalendarEvent[]>;
  todayYmd: string;
  hasFilters: boolean;
}) {
  if (groups.size === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
        <p className="text-3xl">📅</p>
        <p className="mt-2 text-sm text-zinc-400">
          No events match the current filter in the next 90 days.
        </p>
        {hasFilters && (
          <Link href="/calendar" className="mt-3 inline-block text-xs text-emerald-400 hover:underline">
            Clear filters →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([day, es]) => {
        const rel = Math.round((Date.parse(day + "T12:00:00Z") - Date.parse(todayYmd + "T12:00:00Z")) / 86_400_000);
        return (
          <section key={day}>
            <h2 className="mb-2 flex items-baseline gap-3 border-b border-zinc-800 pb-1">
              <span className="text-base font-bold text-zinc-100">
                {new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
              </span>
              <span className="text-xs text-zinc-500">
                {rel === 0 ? "today" : rel === 1 ? "tomorrow" : rel === -1 ? "yesterday" : rel < 0 ? `${Math.abs(rel)}d ago` : `in ${rel}d`}
              </span>
            </h2>
            <ul className="space-y-2">
              {es.map((e, i) => <EventCard key={i} e={e} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
