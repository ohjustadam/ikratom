"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { STATE_NAMES } from "@/lib/state-names";

/**
 * State + date selector for /brief. Lets any user re-scope the daily brief
 * to a different state (not just their home state) and to a previous civic
 * day — the brief re-windows every section to "what was fresh as of that
 * day" and loads that day's archived audio (national) or reads it aloud
 * client-side (state scopes / days with no pre-render).
 *
 * Server-driven: changing a control navigates to /brief?state=&date= and the
 * server page re-renders. State codes are validated server-side before they
 * ever touch a query; this control only proposes them.
 */
type Props = {
  /** Current scope: "national" or a 2-letter state code. */
  scope: string;
  /** Currently-selected civic day, YYYY-MM-DD (Eastern). */
  date: string;
  /** Today's civic day (max selectable), YYYY-MM-DD. */
  today: string;
  /** Oldest selectable civic day, YYYY-MM-DD. */
  minDate: string;
};

export default function BriefScopePicker({ scope, date, today, minDate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Read the changed value synchronously, then navigate inside the transition.
  const go = (nextScope: string, nextDate: string) => {
    const params = new URLSearchParams();
    if (nextScope && nextScope !== "national") params.set("state", nextScope);
    if (nextDate && nextDate !== today) params.set("date", nextDate);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/brief?${qs}` : "/brief"));
  };

  const codes = Object.keys(STATE_NAMES).sort((a, b) =>
    STATE_NAMES[a].localeCompare(STATE_NAMES[b]),
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
      <label className="flex items-center gap-1.5">
        <span className="text-zinc-500">Scope</span>
        <select
          value={scope}
          onChange={(e) => go(e.target.value, date)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
          aria-label="Choose a state to view its brief"
        >
          <option value="national">🌎 National</option>
          {codes.map((c) => (
            <option key={c} value={c}>
              {STATE_NAMES[c]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-zinc-500">Day</span>
        <input
          type="date"
          value={date}
          min={minDate}
          max={today}
          onChange={(e) => go(scope, e.target.value || today)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none [color-scheme:dark]"
          aria-label="Choose a day to view a past brief"
        />
      </label>

      {date !== today && (
        <button
          onClick={() => go(scope, today)}
          className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2 py-1 font-semibold text-emerald-200 hover:border-emerald-500"
        >
          ↺ Today
        </button>
      )}

      {pending && <span className="text-zinc-500">loading…</span>}
    </div>
  );
}
