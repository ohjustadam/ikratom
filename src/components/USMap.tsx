"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { US_VIEWBOX, US_STATE_PATHS } from "@/lib/us-map-paths";
import {
  LEGAL_STATUS_FILL,
  LEGAL_STATUS_UNKNOWN,
  legalStatusFill,
  legalStatusLabel,
} from "@/lib/legal-status";

type StatusByAbbr = Record<string, string | null | undefined>;

/** Per-state forum activity, used to surface where discussion is happening. */
export type MapActivity = { threads: number; posts: number; lastActivity?: string | null };
type ActivityByAbbr = Record<string, MapActivity | undefined>;

const ACTIVITY_DOT = "#a7f3d0"; // emerald-200 — reads on every status fill

export function USMap({
  statusByAbbr,
  onClickHref = (abbr) => `/forum/${abbr}`,
  highlightAbbr,
  activityByAbbr,
}: {
  statusByAbbr: StatusByAbbr;
  onClickHref?: (abbr: string) => string;
  highlightAbbr?: string | null;
  /** When provided, states with forum threads/posts get an activity dot
   *  (sized by volume) + enriched hover tooltip — turns the map into a
   *  "where's the conversation" navigator, not just a legality chart. */
  activityByAbbr?: ActivityByAbbr;
}) {
  const router = useRouter();
  const gRef = useRef<SVGGElement>(null);
  const [hoverAbbr, setHoverAbbr] = useState<string | null>(null);
  const [centroids, setCentroids] = useState<Record<string, { x: number; y: number }>>({});

  const hoverState = hoverAbbr
    ? US_STATE_PATHS.find((s) => s.abbr === hoverAbbr)
    : null;
  const hoverStatus = hoverAbbr ? (statusByAbbr[hoverAbbr] ?? null) : null;
  const hoverActivity = hoverAbbr ? activityByAbbr?.[hoverAbbr] : null;

  const isActive = (a?: MapActivity) => !!a && (a.threads > 0 || a.posts > 0);

  // Measure state-path centroids once (client-only) so we can drop activity
  // dots. getBBox needs a rendered SVG, hence the effect.
  useEffect(() => {
    if (!activityByAbbr || !gRef.current) return;
    const next: Record<string, { x: number; y: number }> = {};
    for (const [abbr, act] of Object.entries(activityByAbbr)) {
      if (!isActive(act)) continue;
      if (!/^[A-Z]{2,4}$/.test(abbr)) continue; // trusted state codes only — no selector injection
      const el = gRef.current.querySelector<SVGGraphicsElement>(`[data-abbr="${abbr}"]`);
      if (!el) continue;
      try {
        const b = el.getBBox();
        next[abbr] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      } catch { /* element not measurable yet — skip */ }
    }
    setCentroids(next);
  }, [activityByAbbr]);

  function dotRadius(a: MapActivity): number {
    const v = a.threads + a.posts;
    if (v >= 12) return 6;
    if (v >= 4) return 5;
    return 4;
  }

  return (
    <div className="relative">
      <svg
        viewBox={US_VIEWBOX}
        className="block w-full"
        role="img"
        aria-label="US kratom legality + forum activity map"
      >
        <g ref={gRef}>
          {US_STATE_PATHS.map(({ abbr, name, d }) => {
            const status = statusByAbbr[abbr] ?? null;
            const fill = legalStatusFill(status);
            const isHover = hoverAbbr === abbr;
            const isHighlight = highlightAbbr === abbr;
            const act = activityByAbbr?.[abbr];
            const activeLabel = isActive(act) ? ` · ${act?.threads ?? 0} threads · ${act?.posts ?? 0} posts` : "";
            return (
              <path
                key={abbr}
                d={d}
                data-abbr={abbr}
                fill={fill}
                stroke={isHighlight ? "#ffffff" : "rgba(15,23,42,0.7)"}
                strokeWidth={isHighlight ? 2 : 0.5}
                vectorEffect="non-scaling-stroke"
                opacity={isHover ? 0.8 : 1}
                style={{
                  cursor: "pointer",
                  pointerEvents: "all",
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={() => setHoverAbbr(abbr)}
                onMouseLeave={() => setHoverAbbr((c) => (c === abbr ? null : c))}
                onClick={() => router.push(onClickHref(abbr))}
              >
                <title>{`${name} — ${legalStatusLabel(status)}${activeLabel}`}</title>
              </path>
            );
          })}

          {/* Forum-activity dots (sized by thread+post volume). pointer-events
              off so they never swallow a click meant for the state beneath. */}
          {Object.entries(centroids).map(([abbr, c]) => {
            const act = activityByAbbr?.[abbr];
            if (!act) return null;
            return (
              <circle
                key={`dot-${abbr}`}
                cx={c.x}
                cy={c.y}
                r={dotRadius(act)}
                fill={ACTIVITY_DOT}
                stroke="rgba(6,78,59,0.9)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
            );
          })}
        </g>
      </svg>

      {/* Floating tooltip */}
      {hoverState && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-1.5 text-xs shadow-lg">
          <span className="font-semibold text-zinc-100">{hoverState.name}</span>
          <span
            className="ml-2 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ backgroundColor: legalStatusFill(hoverStatus) }}
          />
          <span className="ml-1.5 text-zinc-400">
            {legalStatusLabel(hoverStatus)}
          </span>
          {isActive(hoverActivity ?? undefined) && (
            <span className="ml-2 text-emerald-300">
              · {hoverActivity?.threads ?? 0} threads · {hoverActivity?.posts ?? 0} posts
            </span>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Legend color={LEGAL_STATUS_FILL.banned} label="Banned" />
        <Legend color={LEGAL_STATUS_FILL.restricted} label="Restricted" />
        <Legend color={LEGAL_STATUS_FILL.legal} label="Legal · unprotected" />
        <Legend color={LEGAL_STATUS_FILL.incoming} label="Protection incoming" />
        <Legend color={LEGAL_STATUS_FILL.kcpa} label="Protected · KCPA" />
        <Legend color={LEGAL_STATUS_UNKNOWN} label="Tracking" />
        {activityByAbbr && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACTIVITY_DOT }} />
            <span className="text-zinc-400">Forum activity</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}
