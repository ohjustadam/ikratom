"use client";

import { useState } from "react";
import { StanceRow } from "./StanceRow";
import { BulkApprovePanel } from "./BulkApprovePanel";

type Stance = "champion" | "sympathetic" | "neutral" | "hostile" | "unknown";

type Leg = {
  id: string;
  full_name: string;
  role: string;
  district: string | null;
};

type StanceInfo = {
  stance: Stance;
  rationale_md: string | null;
  last_evidence_url: string | null;
  last_updated_at: string | null;
} | null;

/**
 * Client-side wrapper for /admin/stance. Manages the multi-select
 * state for bulk approval, renders both the rows + the bulk action
 * sticky panel.
 *
 * Each row gets a checkbox; the panel appears when any are selected.
 */
export function StanceList({
  legs,
  stanceEntries,
}: {
  legs: Leg[];
  stanceEntries: Array<[string, NonNullable<StanceInfo>]>;
}) {
  const stances = new Map(stanceEntries);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(legs.map((l) => l.id)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  return (
    <>
      {/* Select controls */}
      {legs.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={selectAllVisible}
            className="text-emerald-400 hover:underline"
          >
            Select all visible ({legs.length})
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-zinc-500 hover:text-zinc-300"
            >
              Clear selection
            </button>
          )}
          <span className="ml-auto text-zinc-500">
            {selected.size > 0 ? `${selected.size} selected` : "Tap checkboxes to bulk-approve"}
          </span>
        </div>
      )}

      {/* Rows with checkboxes */}
      <ul className="space-y-2">
        {legs.map((l) => (
          <li key={l.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={selected.has(l.id)}
              onChange={() => toggle(l.id)}
              aria-label={`Select ${l.full_name} for bulk approve`}
              className="mt-4 h-4 w-4 flex-shrink-0 accent-emerald-500"
            />
            <div className="flex-1 min-w-0">
              <StanceRow
                legId={l.id}
                legName={l.full_name}
                role={l.role}
                district={l.district}
                initial={stances.get(l.id) ?? null}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Sticky bulk panel */}
      <BulkApprovePanel
        selectedIds={Array.from(selected)}
        onCleared={clearAll}
      />
    </>
  );
}
