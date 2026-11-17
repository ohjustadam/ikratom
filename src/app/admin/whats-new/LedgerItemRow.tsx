import { AREAS, AREA_KEYS, TYPES, TYPE_KEYS, type Area, type ChangeType, type PatchNoteItem } from "@/lib/patch-note-items";

/** One editable ledger row in /admin/whats-new. */
const IN = "rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs";

export default function LedgerItemRow({
  item,
  onChange,
  onMove,
  onRemove,
}: {
  item: PatchNoteItem;
  onChange: (patch: Partial<PatchNoteItem>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <li className="grid gap-1.5 rounded border border-zinc-800/70 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={item.mergedOn}
          onChange={(e) => onChange({ mergedOn: e.target.value })}
          aria-label="Date"
          className={IN}
        />
        <input
          type="number"
          min={1}
          value={item.pr ?? ""}
          onChange={(e) => onChange({ pr: e.target.value ? Number(e.target.value) : null })}
          placeholder="PR"
          aria-label="PR number"
          className={`${IN} w-20`}
        />
        <select value={item.area} onChange={(e) => onChange({ area: e.target.value as Area })} aria-label="Area" className={IN}>
          {AREA_KEYS.map((a) => (
            <option key={a} value={a}>
              {AREAS[a].label}
            </option>
          ))}
        </select>
        <select value={item.type} onChange={(e) => onChange({ type: e.target.value as ChangeType })} aria-label="Type" className={IN}>
          {TYPE_KEYS.map((t) => (
            <option key={t} value={t}>
              {TYPES[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={item.memberReport}
            onChange={(e) => onChange({ memberReport: e.target.checked })}
          />
          Member report
        </label>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => onMove(-1)} aria-label="Move up" className="px-1 text-xs text-zinc-400 hover:text-emerald-400">↑</button>
          <button type="button" onClick={() => onMove(1)} aria-label="Move down" className="px-1 text-xs text-zinc-400 hover:text-emerald-400">↓</button>
          <button type="button" onClick={onRemove} className="px-1 text-xs text-zinc-400 hover:text-red-400">Remove</button>
        </span>
      </div>
      <input
        value={item.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="What changed, in a member's words"
        aria-label="Title"
        className={`${IN} w-full text-sm`}
      />
      <input
        value={item.detail ?? ""}
        onChange={(e) => onChange({ detail: e.target.value || null })}
        placeholder="One more line (optional)"
        aria-label="Detail"
        className={`${IN} w-full`}
      />
    </li>
  );
}
