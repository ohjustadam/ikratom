/**
 * Screenshot with overlay annotations — numbered callout pins + arrows
 * + captioned highlights — using absolute-positioned divs over the
 * image. Easier to update than baking annotations into PNGs because
 * copy + positions are editable inline.
 *
 * Usage:
 *   <AnnotatedScreenshot
 *     src="/how-it-works/dashboard.PNG"
 *     alt="Dashboard"
 *     pins={[
 *       { x: 12, y: 30, n: 1, caption: "Your matched legislators load here" },
 *       { x: 65, y: 80, n: 2, caption: "One-click send button" },
 *     ]}
 *   />
 *
 * Coordinates are 0-100 (percent of the image's box). The image is
 * `object-contain` so a tall screenshot doesn't crop on narrow viewports.
 */

import Image from "next/image";

export type Pin = {
  /** Horizontal position 0–100 (% of image width) */
  x: number;
  /** Vertical position 0–100 (% of image height) */
  y: number;
  /** Pin number (1, 2, 3, …). */
  n: number;
  /** Short caption rendered next to the pin. */
  caption: string;
  /** Optional position of the caption relative to the pin. */
  side?: "right" | "left" | "top" | "bottom";
};

export function AnnotatedScreenshot({
  src,
  alt,
  pins = [],
  width = 1200,
  height = 800,
}: {
  src: string;
  alt: string;
  pins?: Pin[];
  width?: number;
  height?: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="block h-auto w-full"
        sizes="(max-width: 768px) 100vw, 720px"
      />
      {/* Overlay layer for pins; pointer-events-none so the image stays clickable */}
      <div className="pointer-events-none absolute inset-0">
        {pins.map((p) => (
          <PinDot key={p.n} pin={p} />
        ))}
      </div>
      {/* Below-image legend repeating the pins (keeps it readable on mobile
          where the overlay can crowd the image). */}
      {pins.length > 0 && (
        <ol className="space-y-1 border-t border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
          {pins.map((p) => (
            <li key={p.n} className="flex gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 font-mono text-[10px] font-bold text-zinc-950">
                {p.n}
              </span>
              <span>{p.caption}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PinDot({ pin }: { pin: Pin }) {
  const side = pin.side ?? "right";
  const offset = side === "right"
    ? "left-full ml-3"
    : side === "left"
      ? "right-full mr-3"
      : side === "top"
        ? "bottom-full mb-3 left-1/2 -translate-x-1/2"
        : "top-full mt-3 left-1/2 -translate-x-1/2";

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
    >
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-500 font-mono text-xs font-bold text-zinc-950 shadow-lg">
          {pin.n}
        </span>
      </span>
      {/* Caption — hidden on small screens to avoid clutter; the legend below the image carries them */}
      <span
        className={`pointer-events-none absolute hidden min-w-[200px] max-w-[260px] rounded-md border border-emerald-700/50 bg-zinc-950/95 px-2 py-1 text-xs text-zinc-100 shadow-xl backdrop-blur sm:block ${offset}`}
        style={{ top: side === "right" || side === "left" ? "0" : undefined }}
      >
        {pin.caption}
      </span>
    </div>
  );
}
