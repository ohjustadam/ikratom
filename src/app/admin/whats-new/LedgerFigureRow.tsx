import type { PatchNoteFigure } from "@/lib/patch-note-items";

/** One editable number tile in /admin/whats-new. */
const IN = "rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs";

export default function LedgerFigureRow({
  figure,
  onChange,
  onRemove,
}: {
  figure: PatchNoteFigure;
  onChange: (patch: Partial<PatchNoteFigure>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded border border-zinc-800/70 p-2">
      <input
        type="number"
        step="any"
        value={Number.isFinite(figure.value) ? figure.value : ""}
        onChange={(e) => onChange({ value: Number(e.target.value) })}
        aria-label="Number"
        className={`${IN} w-24`}
      />
      <input
        value={figure.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="votes on record, by name"
        aria-label="Label"
        className={`${IN} min-w-0 flex-1`}
      />
      <input
        value={figure.detail ?? ""}
        onChange={(e) => onChange({ detail: e.target.value || null })}
        placeholder="Small print (optional)"
        aria-label="Small print"
        className={`${IN} min-w-0 flex-[2_1_14rem]`}
      />
      <input
        value={figure.key}
        onChange={(e) => onChange({ key: e.target.value })}
        aria-label="Key"
        title="A short id for this tile: letters, digits and _"
        className={`${IN} w-28 font-mono`}
      />
      <button type="button" onClick={onRemove} className="px-1 text-xs text-zinc-400 hover:text-red-400">
        Remove
      </button>
    </li>
  );
}
