"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { US_VIEWBOX, US_STATE_PATHS } from "@/lib/us-map-paths";

type StatusByAbbr = Record<string, string | null | undefined>;

// Tuned for dark backgrounds — every status reads distinctly.
const STATUS_FILL: Record<string, string> = {
  kcpa: "#10b981",         // emerald-500 — protected (gold standard)
  legal: "#475569",        // slate-600 — neutral; doesn't dominate
  restricted: "#f59e0b",   // amber-500 — caution
  banned: "#dc2626",       // red-600 — repeal target
};

const STATUS_LABEL: Record<string, string> = {
  kcpa: "KCPA-protected",
  legal: "Legal",
  restricted: "Restricted",
  banned: "Banned",
};

export function USMap({
  statusByAbbr,
  onClickHref = (abbr) => `/forum/${abbr}`,
  highlightAbbr,
}: {
  statusByAbbr: StatusByAbbr;
  onClickHref?: (abbr: string) => string;
  highlightAbbr?: string | null;
}) {
  const router = useRouter();
  const [hoverAbbr, setHoverAbbr] = useState<string | null>(null);

  const hoverState = hoverAbbr
    ? US_STATE_PATHS.find((s) => s.abbr === hoverAbbr)
    : null;
  const hoverStatus = hoverAbbr ? (statusByAbbr[hoverAbbr] ?? "legal") : null;

  return (
    <div className="relative">
      <svg
        viewBox={US_VIEWBOX}
        className="block w-full"
        role="img"
        aria-label="US kratom legality map"
      >
        <g>
          {US_STATE_PATHS.map(({ abbr, name, d }) => {
            const status = statusByAbbr[abbr] ?? "legal";
            const fill = STATUS_FILL[status] ?? "#3f3f46";
            const isHover = hoverAbbr === abbr;
            const isHighlight = highlightAbbr === abbr;
            return (
              <path
                key={abbr}
                d={d}
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
                <title>{`${name} — ${STATUS_LABEL[status] ?? status}`}</title>
              </path>
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
            style={{ backgroundColor: STATUS_FILL[hoverStatus ?? "legal"] }}
          />
          <span className="ml-1.5 text-zinc-400">
            {STATUS_LABEL[hoverStatus ?? "legal"] ?? "—"}
          </span>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Legend color={STATUS_FILL.banned} label="Banned" />
        <Legend color={STATUS_FILL.restricted} label="Restricted" />
        <Legend color={STATUS_FILL.legal} label="Legal" />
        <Legend color={STATUS_FILL.kcpa} label="KCPA-protected" />
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
