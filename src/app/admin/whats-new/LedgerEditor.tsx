"use client";

import { useEffect, useState, useTransition } from "react";
import { getPatchNoteLedger, savePatchNoteLedger } from "@/modules/admin/patch-note-ledger-actions";
import type { PatchNoteFigure, PatchNoteItem } from "@/lib/patch-note-items";
import LedgerItemRow from "./LedgerItemRow";
import LedgerFigureRow from "./LedgerFigureRow";

/**
 * The ledger behind /whats-new/[slug]: one row per change members can see, and
 * the number tiles. A plain editable list. The generator drafts the items from
 * commits; fix the wording, area and type here, then Save. Publish checks the
 * items the same way it checks the note.
 */
const BTN = "rounded bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700 disabled:opacity-50";

export default function LedgerEditor({ slug, publishedOn }: { slug: string; publishedOn: string }) {
  const [items, setItems] = useState<PatchNoteItem[] | null>(null);
  const [figures, setFigures] = useState<PatchNoteFigure[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getPatchNoteLedger(slug).then((r) => {
      if (!live) return;
      if ("error" in r) return setMsg(r.error);
      setItems(r.items);
      setFigures(r.figures);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  if (!items) return <p className="text-xs text-zinc-500">{msg ?? "Loading items…"}</p>;

  const setItem = (n: number, patch: Partial<PatchNoteItem>) =>
    setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  const move = (n: number, d: -1 | 1) => {
    const next = [...items];
    const [it] = next.splice(n, 1);
    next.splice(Math.max(0, Math.min(next.length, n + d)), 0, it);
    setItems(next);
  };
  const addItem = () =>
    setItems([
      ...items,
      { mergedOn: publishedOn, pr: null, area: "bills", type: "fix", title: "", detail: null, memberReport: false, sort: items.length },
    ]);
  const setFigure = (n: number, patch: Partial<PatchNoteFigure>) =>
    setFigures(figures.map((f, i) => (i === n ? { ...f, ...patch } : f)));

  function save() {
    startTransition(async () => {
      const r = await savePatchNoteLedger({ slug, items: items ?? [], figures });
      setMsg("error" in r ? r.error : "Items saved.");
    });
  }

  return (
    <div className="space-y-3 rounded border border-zinc-800 p-3">
      <h3 className="text-sm font-semibold">Ledger items ({items.length})</h3>
      <p className="text-xs text-zinc-500">
        With at least one item, the public page shows the scoreboard and the ledger instead of the
        markdown. Only changes members can see. No internal or security work.
      </p>
      <ol className="space-y-2">
        {items.map((it, n) => (
          <LedgerItemRow
            key={n}
            item={it}
            onChange={(p) => setItem(n, p)}
            onMove={(d) => move(n, d)}
            onRemove={() => setItems(items.filter((_, i) => i !== n))}
          />
        ))}
      </ol>
      <button type="button" onClick={addItem} className={BTN}>
        + Add item
      </button>

      <h3 className="pt-2 text-sm font-semibold">Number tiles ({figures.length})</h3>
      <ol className="space-y-2">
        {figures.map((f, n) => (
          <LedgerFigureRow
            key={n}
            figure={f}
            onChange={(p) => setFigure(n, p)}
            onRemove={() => setFigures(figures.filter((_, i) => i !== n))}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={() => setFigures([...figures, { key: `figure_${figures.length + 1}`, value: 0, label: "", detail: null }])}
        className={BTN}
      >
        + Add tile
      </button>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-3">
        <button type="button" onClick={save} disabled={pending} className={BTN}>
          Save items
        </button>
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>
    </div>
  );
}
