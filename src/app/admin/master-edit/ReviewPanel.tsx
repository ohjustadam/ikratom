"use client";

import type { MasterEditRow } from "@/modules/admin/master-edit-actions";

/** Dry-run diff preview: exactly what will be written, before → after. */
export function ReviewPanel({
  drafts, rows, idOf, busy, onCancel, onApply,
}: {
  drafts: Record<string, Record<string, string>>;
  rows: MasterEditRow[];
  idOf: (r: MasterEditRow) => string;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const fmt = (v: unknown) => {
    const s = String(v ?? "");
    return s === "" ? "∅" : s.length > 80 ? s.slice(0, 80) + "…" : s;
  };
  return (
    <div className="rounded-lg border border-amber-700/60 bg-amber-950/10 p-4">
      <p className="mb-2 text-sm font-medium text-amber-200">Review — these exact changes will be applied and audit-logged:</p>
      <ul className="space-y-1.5">
        {Object.entries(drafts).map(([id, changes]) => {
          const row = rows.find((r) => idOf(r) === id);
          return Object.entries(changes).map(([col, to]) => (
            <li key={`${id}:${col}`} className="text-xs text-zinc-300">
              <span className="font-mono text-zinc-500">{id.slice(0, 8)}</span>{" "}
              <span className="font-mono text-sky-300">{col}</span>:{" "}
              <span className="text-red-300/80 line-through">{fmt(row?.[col])}</span>{" "}
              → <span className="text-emerald-300">{fmt(to)}</span>
            </li>
          ));
        })}
      </ul>
      <div className="mt-3 flex gap-2">
        <button onClick={onApply} disabled={busy} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          {busy ? "Applying…" : "Apply changes"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600 disabled:opacity-50">
          Back to editing
        </button>
      </div>
    </div>
  );
}
