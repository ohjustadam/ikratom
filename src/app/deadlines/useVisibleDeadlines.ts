"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DatedDeadlineItem, DeadlineItem } from "./types";

const DAY = 86_400_000;
const HORIZON_DAYS = 90;

/**
 * The per-viewer half of /deadlines: the `?state=` narrow and the clock.
 *
 * WHY THE CLOCK LIVES HERE (2026-09-10). The page is now ISR'd, so the HTML a
 * visitor gets may have been rendered days ago. Bucketing a *deadline* radar
 * against the render-time clock would show "3d left" for a window that closed
 * last week. So the server ships a slightly-wider candidate set and the live
 * bucketing happens against the browser's clock.
 *
 * `baselineNow` is the render-time clock, passed down as a prop. The first
 * client render MUST use it — otherwise hydration disagrees with the
 * prerendered HTML — and the effect then swaps in the real clock for people
 * with JavaScript. Crawlers keep the render-time bucketing, which is correct
 * as of the moment the page was generated.
 */
export function useVisibleDeadlines(items: DeadlineItem[], baselineNow: number) {
  const sp = useSearchParams();
  const raw = (sp.get("state") ?? "").toUpperCase();
  const stateFilter = /^[A-Z]{2}$/.test(raw) ? raw : null;

  const [now, setNow] = useState(baselineNow);
  useEffect(() => setNow(Date.now()), []);

  const visible = useMemo<DatedDeadlineItem[]>(
    () =>
      items
        .filter((i) => !stateFilter || i.filterState === stateFilter)
        .map((i) => ({ ...i, ms: Date.parse(i.deadline) }))
        .filter((i) => i.ms > now && i.ms < now + HORIZON_DAYS * DAY)
        .sort((a, b) => a.ms - b.ms),
    [items, stateFilter, now],
  );

  const urgent = visible.filter((i) => i.ms - now < 7 * DAY);
  const soon = visible.filter((i) => i.ms - now >= 7 * DAY && i.ms - now < 30 * DAY);
  const later = visible.filter((i) => i.ms - now >= 30 * DAY);

  return { stateFilter, now, visible, urgent, soon, later };
}
