"use client";

import type { DeadlineItem } from "./types";
import { useVisibleDeadlines } from "./useVisibleDeadlines";

/**
 * The "N windows open" line under the page blurb. Its own client island so the
 * <h1> and description above it stay in the static shell — `useSearchParams`
 * pushes everything up to the nearest Suspense boundary to the browser.
 */
export function DeadlineSummary({
  items,
  baselineNow,
}: {
  items: DeadlineItem[];
  baselineNow: number;
}) {
  const { stateFilter, visible, urgent } = useVisibleDeadlines(items, baselineNow);

  return (
    <p className="mt-2 text-xs text-zinc-500">
      {visible.length} window{visible.length === 1 ? "" : "s"} open
      {stateFilter ? ` in ${stateFilter}` : " across all jurisdictions"}.
      {urgent.length > 0 && (
        <span className="ml-2 rounded bg-red-950/50 px-1.5 py-0.5 text-red-300">
          {urgent.length} close in &lt; 7 days
        </span>
      )}
    </p>
  );
}
