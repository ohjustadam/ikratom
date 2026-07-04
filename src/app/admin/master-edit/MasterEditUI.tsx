"use client";

import { useState } from "react";
import { searchEntitiesForEdit, applyMasterEdits, type MasterEditRow, type MasterApplyRow } from "@/modules/admin/master-edit-actions";
import { EditableCell } from "./EditableCell";
import { ReviewPanel } from "./ReviewPanel";

export type FieldMeta = { kind: "text" | "bool" | "date" | "enum"; maxLen?: number; values?: string[] };
export type TypeMeta = {
  type: string;
  label: string;
  idCol: string;
  displayCols: string[];
  editable: Record<string, FieldMeta>;
  hasState: boolean;
};

/** drafts[rowId][col] = new value (string form; server coerces + validates) */
type Drafts = Record<string, Record<string, string>>;

export function MasterEditUI({ meta }: { meta: TypeMeta[] }) {
  const [typeKey, setTypeKey] = useState(meta[0].type);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [rows, setRows] = useState<MasterEditRow[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [applied, setApplied] = useState<MasterApplyRow[] | null>(null);

  const t = meta.find((m) => m.type === typeKey)!;
  const editableCols = Object.keys(t.editable);
  const idOf = (r: MasterEditRow) => String(r[t.idCol]);
  const changeCount = Object.values(drafts).reduce((n, d) => n + Object.keys(d).length, 0);

  async function search() {
    setBusy(true); setError(null); setApplied(null);
    const r = await searchEntitiesForEdit(typeKey, query, stateFilter || undefined);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setRows(r.rows); setDrafts({});
  }

  function setDraft(rowId: string, col: string, value: string, original: unknown) {
    setDrafts((prev) => {
      const row = { ...(prev[rowId] ?? {}) };
      if (value === String(original ?? "")) delete row[col];
      else row[col] = value;
      const next = { ...prev, [rowId]: row };
      if (Object.keys(row).length === 0) delete next[rowId];
      return next;
    });
  }

  async function apply() {
    setBusy(true); setError(null);
    const edits = Object.entries(drafts).map(([id, changes]) => ({ type: typeKey, id, changes }));
    const r = await applyMasterEdits(edits);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setApplied(r.results);
    setReviewing(false);
    const okIds = new Set(r.results.filter((x) => x.ok).map((x) => x.id));
    setRows((prev) => prev.map((row) => (okIds.has(idOf(row)) ? { ...row, ...drafts[idOf(row)] } : row)));
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !okIds.has(id))));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">
          Type
          <select value={typeKey} onChange={(e) => { setTypeKey(e.target.value); setRows([]); setDrafts({}); setApplied(null); }} className="mt-1 block rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100">
            {meta.map((m) => <option key={m.type} value={m.type}>{m.label}</option>)}
          </select>
        </label>
        <label className="flex-1 text-xs text-zinc-400">
          Search
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Name, number, or title… (empty = first 50)" className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600" />
        </label>
        {t.hasState && (
          <label className="text-xs text-zinc-400">
            State
            <input value={stateFilter} onChange={(e) => setStateFilter(e.target.value.toUpperCase().slice(0, 2))} placeholder="OK" className="mt-1 block w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600" />
          </label>
        )}
        <button onClick={search} disabled={busy} className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          {busy ? "…" : "Find"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {applied && (
        <div className="rounded border border-zinc-700 bg-zinc-900/60 p-3 text-xs">
          {applied.map((r, i) => (
            <p key={i} className={r.ok ? "text-emerald-300" : "text-red-400"}>{r.ok ? "✓" : "✗"} {r.id.slice(0, 8)}… {r.message}</p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-2 py-2">Row</th>
                {editableCols.map((c) => <th key={c} className="px-2 py-2 font-mono">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = idOf(row);
                return (
                  <tr key={id} className="border-t border-zinc-800/70 align-top">
                    <td className="max-w-[220px] px-2 py-2 text-zinc-300">
                      {t.displayCols.filter((c) => !(c in t.editable) && c !== t.idCol).slice(0, 3).map((c) => (
                        <span key={c} className="mr-2 whitespace-nowrap">{String(row[c] ?? "")?.slice(0, 40)}</span>
                      ))}
                      <span className="block font-mono text-[10px] text-zinc-600">{id.slice(0, 8)}</span>
                    </td>
                    {editableCols.map((col) => (
                      <td key={col} className="px-2 py-1.5">
                        <EditableCell
                          field={t.editable[col]}
                          value={drafts[id]?.[col] ?? String(row[col] ?? "")}
                          changed={drafts[id]?.[col] !== undefined}
                          onChange={(v) => setDraft(id, col, v, row[col])}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {changeCount > 0 && !reviewing && (
        <button onClick={() => setReviewing(true)} className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
          Review {changeCount} change{changeCount === 1 ? "" : "s"} →
        </button>
      )}
      {reviewing && (
        <ReviewPanel
          drafts={drafts}
          rows={rows}
          idOf={idOf}
          busy={busy}
          onCancel={() => setReviewing(false)}
          onApply={apply}
        />
      )}
    </div>
  );
}
