import { AREAS, TYPES, type Area, type LedgerFilter, type SortKey } from "@/lib/patch-note-items";

/** Search, type filter, area chips and (on a phone, where columns fold) a sort menu. */
const FIELD = "rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100";

const SORTS: Array<[string, SortKey, 1 | -1]> = [
  ["Newest first", "mergedOn", -1],
  ["Oldest first", "mergedOn", 1],
  ["By area", "area", 1],
  ["By type", "type", 1],
  ["A to Z", "title", 1],
];

export default function LedgerControls({
  filter,
  present,
  shown,
  total,
  onChange,
  onToggleArea,
  onSort,
}: {
  filter: LedgerFilter;
  present: Area[];
  shown: number;
  total: number;
  onChange: (patch: Partial<LedgerFilter>) => void;
  onToggleArea: (a: Area) => void;
  onSort: (k: SortKey, dir: 1 | -1) => void;
}) {
  const sortIdx = SORTS.findIndex(([, k, d]) => k === filter.sort && d === filter.dir);
  return (
    <div className="mt-3 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filter.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search changes"
          aria-label="Search changes"
          className={`${FIELD} min-w-0 flex-[1_1_12rem]`}
        />
        <select
          value={filter.type}
          onChange={(e) => onChange({ type: e.target.value as LedgerFilter["type"] })}
          aria-label="Type of change"
          className={FIELD}
        >
          <option value="all">All types</option>
          {Object.entries(TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
          <option value="report">Member reports</option>
        </select>
        <select
          value={sortIdx < 0 ? "" : String(sortIdx)}
          onChange={(e) => {
            const s = SORTS[Number(e.target.value)];
            if (s) onSort(s[1], s[2]);
          }}
          aria-label="Sort changes"
          className={`${FIELD} sm:hidden`}
        >
          {sortIdx < 0 && <option value="">Sorted</option>}
          {SORTS.map(([label], i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-zinc-500" aria-live="polite">
          Showing {shown} of {total}
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Areas">
        {present.map((a) => {
          const on = filter.areas.has(a);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleArea(a)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                on ? "border-zinc-600 text-zinc-100" : "border-zinc-800 text-zinc-500 line-through"
              }`}
            >
              <span aria-hidden className={`size-2 rounded-full ${AREAS[a].dot} ${on ? "" : "opacity-40"}`} />
              {AREAS[a].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
