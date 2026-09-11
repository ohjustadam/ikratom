import Link from "next/link";
import { KIND_BADGE, type MkHref } from "./types";

/** List/month toggle + kind pills + state pills. */
export function CalendarFilters({ view, kindFilter, stateFilter, displayMonth, totalCount, counts, stateOptions, mkHref }: {
  view: "list" | "month";
  kindFilter: string | null;
  stateFilter: string | null;
  displayMonth: string;
  totalCount: number;
  counts: Record<string, number>;
  stateOptions: string[];
  mkHref: MkHref;
}) {
  return (
    <div className="mb-4 space-y-2">
      <nav className="flex flex-wrap items-center gap-2 text-xs" aria-label="Calendar layout">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">View</span>
        <FilterPill label="☰ List" href={mkHref({ view: null, day: null })} active={view === "list"} />
        <FilterPill label="▦ Month" href={mkHref({ view: "month", month: displayMonth, day: null })} active={view === "month"} />
      </nav>
      <nav className="flex flex-wrap gap-2 text-xs">
        <FilterPill label={`All kinds (${totalCount})`} href={mkHref({ kind: null })} active={!kindFilter} />
        {Object.entries(counts).map(([k, n]) => n > 0 && (
          <FilterPill
            key={k}
            label={`${KIND_BADGE[k].emoji} ${KIND_BADGE[k].label} (${n})`}
            href={mkHref({ kind: k })}
            active={kindFilter === k}
          />
        ))}
      </nav>
      {stateOptions.length > 0 && (
        <nav className="flex flex-wrap gap-2 text-xs">
          <FilterPill label="All states" href={mkHref({ state: null })} active={!stateFilter} />
          {stateOptions.map((s) => (
            <FilterPill key={s} label={s} href={mkHref({ state: s })} active={stateFilter === s} />
          ))}
        </nav>
      )}
    </div>
  );
}

function FilterPill({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded px-3 py-1.5 ${active ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
    >
      {label}
    </Link>
  );
}
