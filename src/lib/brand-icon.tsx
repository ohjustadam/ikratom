import { ImageResponse } from "next/og";
import { BRAND_EMERALD, BRAND_INK, MARK_D, MARK_VIEWBOX } from "@/lib/brand-mark";

/**
 * The app icon as a PNG response: the "ik" mark at 72% on the ink tile, the
 * same drawing scripts/brand-icons.mjs writes to public/ikratom-icon-*.png.
 * Serves /icon and /apple-icon (the manifest, push notifications and iOS use
 * those routes). See docs/BRAND.md.
 */
export function brandIconResponse(px: number): ImageResponse {
  const mark = Math.round(px * 0.72);
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_INK,
        }}
      >
        <svg width={mark} height={mark} viewBox={MARK_VIEWBOX}>
          <path fill={BRAND_EMERALD} d={MARK_D} />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
