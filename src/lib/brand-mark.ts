/**
 * The iKratom "ik" mark: concept A, "leaf dot" (owner's pick, 2026-11-24).
 * The dot on the i is a kratom leaf with its vein cut out. Usage rules are in
 * docs/BRAND.md.
 *
 * ONE drawing, ONE path. The master file is public/brand/ik-mark.svg, and a
 * test keeps MARK_D identical to it. Every surface draws from here: the site
 * header (BrandMark), the app icons and favicon (icon.tsx, apple-icon.tsx,
 * scripts/brand-icons.mjs), the link-preview cards (og-card.tsx) and the email
 * header (the generated PNGs). Never re-type the mark in a font.
 *
 * Geometry: a 64-unit grid with 12-unit stems, so at 16 px every stem edge lands
 * on a whole pixel. The leaf's rotation is baked into its coordinates, and the
 * vein is a reverse-wound subpath, so the default nonzero fill cuts it out with
 * no transform or fill-rule. That keeps it identical in browsers, sharp and the
 * OG-image renderer.
 */
export const MARK_VIEWBOX = "0 0 64 64";

export const MARK_D =
  "M4,24H16V60H4Z M14.93,3.23 C16.82,8.2 16.68,13.79 14.54,17.18 C12.72,20.17 8.89,20.97 6.24,19.56 C3.6,18.16 2.12,14.54 3.59,11.36 C5.2,7.68 9.75,4.44 14.93,3.23Z M8.3,17.83 C10.53,12.78 12.14,9.11 13.52,5.88 C11.61,8.83 9.47,12.22 6.53,16.89Z M20,4H32V33.5L41.5,24H58.5L40.5,42L58.5,60H41.5L32,50.5V60H20Z";

/** The one emerald. On light grounds use the deeper shade for contrast. */
export const BRAND_EMERALD = "#10b981";
export const BRAND_EMERALD_DEEP = "#059669";
export const BRAND_INK = "#0a0a0a";

/** A standalone SVG string (for data URIs and scripts). `tile` draws a square ground behind it. */
export function markSvg(fill: string, opts: { size?: number; tile?: string; scale?: number } = {}): string {
  const size = opts.size ?? 64;
  const scale = opts.scale ?? (opts.tile ? 0.72 : 1);
  const off = (64 - 64 * scale) / 2;
  const ground = opts.tile ? `<rect width="64" height="64" fill="${opts.tile}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}">${ground}<g transform="translate(${off} ${off}) scale(${scale})"><path fill="${fill}" d="${MARK_D}"/></g></svg>`;
}
