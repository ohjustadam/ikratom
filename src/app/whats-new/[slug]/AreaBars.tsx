import { AREAS, countsByArea, type PatchNoteItem } from "@/lib/patch-note-items";

/**
 * Layout D, second half: "where the work went", changes by area as horizontal
 * bars. Every bar carries its area name and count as text, so identity never
 * rests on color, and the split (new / fixed / faster) is in the row's text for
 * screen readers and in its tooltip for a mouse. The ledger below is the full
 * table view of the same rows.
 */
export default function AreaBars({ items }: { items: PatchNoteItem[] }) {
  const rows = countsByArea(items);
  if (rows.length === 0) return null;
  const max = rows[0].n;

  return (
    <section aria-labelledby="where-the-work-went" className="mt-8">
      <h2 id="where-the-work-went" className="text-lg font-semibold">
        Where the work went
      </h2>
      <p className="mt-1 text-sm text-zinc-500">Changes by area.</p>
      <ul className="mt-3 grid gap-2">
        {rows.map((r) => {
          const split = [
            r.split.new && `${r.split.new} new`,
            r.split.fix && `${r.split.fix} fixed`,
            r.split.faster && `${r.split.faster} faster`,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li
              key={r.area}
              title={`${AREAS[r.area].label}: ${split}`}
              className="grid grid-cols-1 items-center gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]"
            >
              <span className="flex items-center gap-2 text-zinc-200">
                <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${AREAS[r.area].dot}`} />
                {AREAS[r.area].label}
              </span>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-4 rounded-r ${AREAS[r.area].dot}`}
                  style={{ width: `calc(${(r.n / max) * 100}% - 2.5rem)`, minWidth: "4px" }}
                />
                <span className="font-mono text-xs tabular-nums text-zinc-200">
                  {r.n}
                  <span className="sr-only"> changes: {split}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
