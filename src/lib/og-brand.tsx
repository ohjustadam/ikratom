import { BRAND_EMERALD, MARK_D, MARK_VIEWBOX } from "@/lib/brand-mark";

/**
 * The brand lockup for link-preview images (satori): the "ik" mark, then the
 * "iKratom" wordmark with an emerald i. The same lockup as the site header.
 * Every element with more than one child is display:flex, as satori requires.
 */
export function OgBrand({ fontSize }: { fontSize: number }) {
  const mark = Math.round(fontSize * 1.3);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <svg width={mark} height={mark} viewBox={MARK_VIEWBOX} style={{ marginRight: Math.round(fontSize * 0.35) }}>
        <path fill={BRAND_EMERALD} d={MARK_D} />
      </svg>
      <div style={{ display: "flex", fontSize, fontWeight: 800, color: "#fafafa" }}>
        <span style={{ color: BRAND_EMERALD }}>i</span>
        <span>Kratom</span>
      </div>
    </div>
  );
}
