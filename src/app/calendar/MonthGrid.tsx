import Link from "next/link";
import { EventCard } from "./EventCard";
import { KIND_BADGE, type CalendarEvent, type MkHref } from "./types";

/** Month grid (7-col weeks) + prev/next nav + the selected day's events. */
export function MonthGrid({ displayMonth, todayYmd, selectedDay, buckets, mkHref }: {
  displayMonth: string;
  todayYmd: string;
  selectedDay: string;
  buckets: Map<string, CalendarEvent[]>;
  mkHref: MkHref;
}) {
  const [yy, mm] = displayMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();           // mm is 1-based → day 0 of next month
  const firstWeekday = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay();        // 0=Sun
  const monthLabel = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const prevMonth = mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, "0")}`;
  const nextMonth = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${displayMonth}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  // Chunk into weeks so the grid has a valid ARIA structure (grid > row > cell).
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <section aria-label={`Month view, ${monthLabel}`}>
      <div className="mb-3 flex items-center justify-between">
        <Link href={mkHref({ view: "month", month: prevMonth, day: null })} aria-label="Previous month"
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 text-sm hover:border-emerald-500">←</Link>
        <h2 className="text-base font-bold text-zinc-100">{monthLabel}</h2>
        <Link href={mkHref({ view: "month", month: nextMonth, day: null })} aria-label="Next month"
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 text-sm hover:border-emerald-500">→</Link>
      </div>

      <div role="grid" aria-label={`${monthLabel} calendar`} className="grid grid-cols-7 gap-1">
        {/* display:contents rows give a valid grid>row>cell ARIA tree while the
            cells still flow into the parent's CSS grid columns. */}
        <div role="row" className="contents">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <span className="hidden sm:inline">{w}</span><span className="sm:hidden">{w[0]}</span>
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className="contents">
            {week.map((key, i) => {
              if (!key) return <div key={`b${wi}-${i}`} role="gridcell" aria-hidden="true" className="min-h-[3.25rem] rounded bg-zinc-950/20 sm:min-h-[5.5rem]" />;
              const d = Number(key.slice(-2));
              const evs = buckets.get(key) ?? [];
              const isToday = key === todayYmd;
              const isSelected = key === selectedDay;
              return (
                // gridcell wraps the <Link> so the anchor keeps its native link role.
                <div key={key} role="gridcell" aria-current={isSelected ? "date" : undefined}>
                  <Link
                    href={mkHref({ view: "month", month: displayMonth, day: key })}
                    aria-label={`${monthLabel} ${d}${isToday ? ", today" : ""}, ${evs.length} event${evs.length === 1 ? "" : "s"}`}
                    className={`flex h-full min-h-[3.25rem] flex-col overflow-hidden rounded border p-1 text-left transition sm:min-h-[5.5rem] ${
                      isSelected ? "border-emerald-400 bg-emerald-950/40 ring-1 ring-emerald-400"
                      : isToday ? "border-emerald-600/60 bg-emerald-950/15"
                      : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-600/50"
                    }`}
                  >
                    <span className={`text-[11px] font-semibold ${isToday ? "text-emerald-300" : "text-zinc-400"}`}>{d}</span>
                    {/* chips with titles on sm+ */}
                    <span className="mt-0.5 hidden flex-col gap-0.5 sm:flex">
                      {evs.slice(0, 3).map((e, j) => (
                        <span key={j} className={`truncate rounded border px-1 text-[9px] leading-tight ${KIND_BADGE[e.kind].cls}`}>
                          {KIND_BADGE[e.kind].emoji} {e.title}
                        </span>
                      ))}
                      {evs.length > 3 && <span className="text-[9px] text-zinc-500">+{evs.length - 3} more</span>}
                    </span>
                    {/* compact emoji dots on mobile */}
                    {evs.length > 0 && (
                      <span className="mt-auto flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                        {evs.slice(0, 4).map((e, j) => <span key={j} className="text-[9px]">{KIND_BADGE[e.kind].emoji}</span>)}
                        {evs.length > 4 && <span className="text-[8px] text-zinc-500">+{evs.length - 4}</span>}
                      </span>
                    )}
                  </Link>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <DayDetail day={selectedDay} events={buckets.get(selectedDay) ?? []} />
    </section>
  );
}

/** The selected day's events below the month grid. */
function DayDetail({ day, events }: { day: string; events: CalendarEvent[] }) {
  const label = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <section className="mt-5" aria-live="polite">
      <h3 className="mb-2 border-b border-zinc-800 pb-1 text-sm font-bold text-zinc-100">{label}</h3>
      {events.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-center text-xs text-zinc-500">
          No events on this day. Tap another day above, or switch to <span className="text-zinc-400">List</span> to see everything upcoming.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((e, i) => <EventCard key={i} e={e} />)}
        </ul>
      )}
    </section>
  );
}
