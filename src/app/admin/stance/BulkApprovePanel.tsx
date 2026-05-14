"use client";

import { useState, useTransition } from "react";
import { bulkSetStance } from "@/modules/admin/stance-actions";

/**
 * Bulk-approve drafted stances on /admin/stance.
 *
 * When admin has 50+ legislators showing as 'unknown' stance with
 * AI-drafted rationale, walking through one at a time is friction.
 * This panel batches the obvious cases:
 *
 *   - 'Confirm all as neutral' (most common — committee membership
 *     only with no clear pro/anti signal)
 *   - 'Mark all as unknown' (back-out toggle if AI was over-eager)
 *
 * Surface only renders when at least one legId is selected. Admin
 * checks the rows they want to batch (per StanceRow), then chooses
 * a target stance and confirms. Caps at 100 per click (server-side).
 *
 * Preserves each leg's AI rationale + evidence URL — the bulk action
 * only sets the stance field. Admin is essentially co-signing the AI.
 */
export function BulkApprovePanel({
  selectedIds,
  onCleared,
}: {
  selectedIds: string[];
  onCleared: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  if (selectedIds.length === 0) return null;

  function apply(stance: string) {
    setFeedback(null);
    startTransition(async () => {
      const r = await bulkSetStance({ legislatorIds: selectedIds, stance });
      if ("error" in r && r.error) {
        setFeedback(`✗ ${r.error}`);
      } else if ("ok" in r && r.ok) {
        setFeedback(`✓ Applied "${stance}" to ${r.applied} legislator${r.applied === 1 ? "" : "s"}.`);
        onCleared();
      }
    });
  }

  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-emerald-700/40 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-xs font-semibold text-emerald-300">
          {selectedIds.length} selected
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply("champion")}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-50"
        >
          ⚡ Mark all champion
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply("sympathetic")}
          className="rounded border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
        >
          ✓ Mark all sympathetic
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply("neutral")}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-400 disabled:opacity-50"
        >
          Mark all neutral
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply("hostile")}
          className="rounded border border-red-700/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:border-red-500 disabled:opacity-50"
        >
          🚫 Mark all hostile
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply("unknown")}
          className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300 hover:border-amber-500 disabled:opacity-50"
        >
          ↶ Reset to unknown
        </button>
        <span className="ml-auto text-[11px] text-zinc-500">
          {pending ? "Applying…" : feedback ?? "Co-signs AI rationale; flips stance off 'unknown'."}
        </span>
      </div>
    </div>
  );
}
