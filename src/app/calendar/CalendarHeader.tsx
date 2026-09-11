import Link from "next/link";
import { CalendarSyncButton } from "./CalendarSyncButton";

/** Page header: title, the .ics subscribe CTA, blurb, and the coverage stat. */
export function CalendarHeader({ feedHttps, feedWebcal, feedGoogle, feedScope, eventCount, stateCount }: {
  feedHttps: string;
  feedWebcal: string;
  feedGoogle: string;
  feedScope: string;
  eventCount: number;
  stateCount: number;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            📅 Community Calendar
          </p>
          <h1 className="mt-2 text-3xl font-bold">Every event we know about</h1>
        </div>
        <CalendarSyncButton httpsUrl={feedHttps} webcalUrl={feedWebcal} googleUrl={feedGoogle} scopeLabel={feedScope} />
      </div>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        Elections + primaries · town halls + hearings · city/county meetings ·
        bill action dates · legislative session bookends. One place for every
        public kratom event. Join by Zoom, livestream, in-person, or phone —
        links + addresses below.
      </p>
      <p className="mt-2 text-xs text-zinc-500">
        Found something we missed? Drop the URL in <Link href="/alerts/submit" className="text-emerald-400 hover:underline">intel-tip</Link>.
      </p>

      {/* Coverage stat — surfaces the breadth of what's being surfaced
          so users immediately see "this platform is actually working." */}
      {eventCount > 0 && (
        <p className="mt-2 inline-flex flex-wrap items-baseline gap-1 rounded-md border border-emerald-700/40 bg-emerald-950/15 px-2.5 py-1 text-xs text-emerald-200">
          <span className="font-mono font-bold">{eventCount}</span>
          <span>{eventCount === 1 ? "event" : "events"} across</span>
          <span className="font-mono font-bold">{stateCount}</span>
          <span>{stateCount === 1 ? "state" : "states"} · next 90 days</span>
        </p>
      )}
    </header>
  );
}
