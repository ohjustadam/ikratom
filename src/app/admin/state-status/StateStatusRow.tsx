"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmStateStatus, type StateStatusRow as Row } from "@/modules/state-status/actions";

const LEAF_OPTS = ["", "legal", "kcpa", "banned", "restricted", "protected"];
const OH_OPTS = ["", "legal", "banned", "restricted", "protected"];

export function StateStatusRow({ row }: { row: Row }) {
  const [leaf, setLeaf] = useState(row.admin_leaf_status ?? "");
  const [sevenoh, setSevenoh] = useState(row.admin_7oh_status ?? "");
  const [note, setNote] = useState(row.admin_note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    setErr(null);
    setSaved(false);
    start(async () => {
      const r = await confirmStateStatus({ state: row.state, leaf: leaf || null, sevenoh: sevenoh || null, note });
      if ("error" in r) setErr(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <li className={`rounded-lg border p-4 ${row.needs_review ? "border-amber-700/50 bg-amber-950/10" : "border-zinc-800 bg-zinc-950/40"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-zinc-100">
          {row.name} <span className="text-zinc-500">({row.state})</span>
        </h3>
        {row.needs_review ? (
          <span className="rounded bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-300">⚠ {row.review_reason}</span>
        ) : row.confirmed_at ? (
          <span className="rounded bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-300">confirmed</span>
        ) : null}
      </div>

      <div className="mt-2 grid gap-x-6 gap-y-1 text-[12px] text-zinc-400 sm:grid-cols-2">
        <span>Derived leaf: <b className="text-zinc-200">{row.derived_leaf_status ?? "—"}</b> · 7-OH: <b className="text-zinc-200">{row.derived_7oh_status ?? "—"}</b></span>
        <span>Basis: {row.basis ?? "—"} ({row.enacted_count ?? 0} enacted)</span>
        <span>Legacy status: {row.legacy_kratom_status ?? "—"}</span>
        <span>
          Evidence: {row.leaf_evidence_bill ? `leaf ${row.leaf_evidence_bill}` : ""}
          {row.sevenoh_evidence_bill ? ` · 7-OH ${row.sevenoh_evidence_bill}` : ""}
          {!row.leaf_evidence_bill && !row.sevenoh_evidence_bill ? "—" : ""}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-zinc-500">
          Canonical leaf
          <select value={leaf} onChange={(e) => setLeaf(e.target.value)} className="mt-1 block rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-100">
            {LEAF_OPTS.map((o) => <option key={o} value={o}>{o || "— (use derived)"}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-zinc-500">
          Canonical 7-OH
          <select value={sevenoh} onChange={(e) => setSevenoh(e.target.value)} className="mt-1 block rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-100">
            {OH_OPTS.map((o) => <option key={o} value={o}>{o || "— (use derived)"}</option>)}
          </select>
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note / statute citation (optional)"
          maxLength={2000}
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      {saved && <p className="mt-2 text-xs text-emerald-400">Saved.</p>}
    </li>
  );
}
