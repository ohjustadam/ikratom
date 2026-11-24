import {
  AREAS,
  TYPES,
  prUrl,
  shortDate,
  type ChangeType,
  type LedgerFilter,
  type PatchNoteItem,
  type SortKey,
} from "@/lib/patch-note-items";

/**
 * The ledger rows. On a phone the Date, Area, Type and PR columns fold into a
 * line under each change, so nothing scrolls sideways.
 */
const PILL: Record<ChangeType, string> = {
  new: "border-transparent bg-emerald-500/15 text-emerald-400",
  fix: "border-zinc-700 text-zinc-300",
  faster: "border-dashed border-zinc-600 text-zinc-300",
};
const Pill = ({ t }: { t: ChangeType }) => (
  <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px] ${PILL[t]}`}>{TYPES[t]}</span>
);
const AreaChip = ({ i }: { i: PatchNoteItem }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-400">
    <span aria-hidden className={`size-2 rounded-full ${AREAS[i.area].dot}`} />
    {AREAS[i.area].label}
  </span>
);
const PrLink = ({ pr }: { pr: number | null }) =>
  pr ? (
    <a href={prUrl(pr)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-emerald-400 hover:underline">
      #{pr}
    </a>
  ) : null;

const COLS: Array<[SortKey, string, string]> = [
  ["mergedOn", "Date", "hidden sm:table-cell"],
  ["area", "Area", "hidden md:table-cell"],
  ["title", "Change", ""],
  ["type", "Type", "hidden sm:table-cell"],
  ["pr", "PR", "hidden sm:table-cell"],
];

export default function LedgerTable({
  rows,
  filter,
  onSort,
}: {
  rows: PatchNoteItem[];
  filter: LedgerFilter;
  onSort: (k: SortKey) => void;
}) {
  const td = "border-b border-zinc-800 px-2 py-2.5 align-top";
  return (
    <table className="mt-3 w-full border-collapse text-sm">
      <thead>
        <tr>
          {COLS.map(([k, label, cls]) => (
            <th
              key={k}
              scope="col"
              aria-sort={filter.sort === k ? (filter.dir === 1 ? "ascending" : "descending") : "none"}
              className={`border-b border-zinc-800 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 ${cls}`}
            >
              <button type="button" onClick={() => onSort(k)} className="uppercase hover:text-emerald-400">
                {label}
                {filter.sort === k && <span aria-hidden>{filter.dir === 1 ? " ↑" : " ↓"}</span>}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={`${i.sort}-${i.pr ?? "x"}-${i.title}`} className="hover:bg-zinc-900/60">
            <td className={`${td} hidden whitespace-nowrap font-mono text-xs text-zinc-400 sm:table-cell`}>{shortDate(i.mergedOn)}</td>
            <td className={`${td} hidden md:table-cell`}><AreaChip i={i} /></td>
            <td className={td}>
              <p className="font-medium text-zinc-100">{i.title}</p>
              {i.detail && <p className="mt-0.5 text-xs text-zinc-400">{i.detail}</p>}
              {i.memberReport && <p className="mt-0.5 text-xs text-emerald-400">Member report</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
                <AreaChip i={i} />
                <span className="sm:hidden"><Pill t={i.type} /></span>
                <span className="font-mono text-xs text-zinc-500 sm:hidden">{shortDate(i.mergedOn)}</span>
                <span className="sm:hidden"><PrLink pr={i.pr} /></span>
              </div>
            </td>
            <td className={`${td} hidden sm:table-cell`}><Pill t={i.type} /></td>
            <td className={`${td} hidden sm:table-cell`}><PrLink pr={i.pr} /></td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className={`${td} text-zinc-500`}>
              Nothing matches. Clear the search or turn an area back on.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
