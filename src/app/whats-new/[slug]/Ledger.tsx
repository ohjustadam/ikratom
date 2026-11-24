"use client";

import { useMemo, useState } from "react";
import {
  AREA_KEYS,
  filterAndSort,
  type Area,
  type LedgerFilter,
  type PatchNoteItem,
  type SortKey,
} from "@/lib/patch-note-items";
import LedgerControls from "./LedgerControls";
import LedgerTable from "./LedgerTable";

/**
 * Layout A: every change in one table, searchable and sortable.
 *
 * The page hands this island the full list, and its first render (on the
 * server) shows all of it, newest first, so the ledger reads complete with
 * JavaScript off and to a crawler. The island only filters and sorts what it
 * was given; it never fetches.
 */
const DEFAULT_DIR: Record<SortKey, 1 | -1> = { mergedOn: -1, pr: -1, area: 1, title: 1, type: 1 };

export default function Ledger({ items }: { items: PatchNoteItem[] }) {
  const present = useMemo(() => AREA_KEYS.filter((a) => items.some((i) => i.area === a)), [items]);
  const [f, setF] = useState<LedgerFilter>({
    q: "",
    areas: new Set<Area>(present),
    type: "all",
    sort: "mergedOn",
    dir: -1,
  });
  const rows = useMemo(() => filterAndSort(items, f), [items, f]);

  const update = (patch: Partial<LedgerFilter>) => setF((prev) => ({ ...prev, ...patch }));
  const toggleArea = (a: Area) =>
    setF((prev) => {
      const areas = new Set(prev.areas);
      if (areas.has(a)) areas.delete(a);
      else areas.add(a);
      return { ...prev, areas };
    });
  const sortBy = (k: SortKey, dir?: 1 | -1) =>
    setF((prev) => ({
      ...prev,
      sort: k,
      dir: dir ?? (prev.sort === k ? (prev.dir === 1 ? -1 : 1) : DEFAULT_DIR[k]),
    }));

  return (
    <section aria-labelledby="every-change" className="mt-10">
      <h2 id="every-change" className="text-lg font-semibold">
        Every change
      </h2>
      <LedgerControls
        filter={f}
        present={present}
        shown={rows.length}
        total={items.length}
        onChange={update}
        onToggleArea={toggleArea}
        onSort={sortBy}
      />
      <LedgerTable rows={rows} filter={f} onSort={sortBy} />
    </section>
  );
}
