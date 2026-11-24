# The "ik" mark

iKratom's symbol. Treat it like a trademark: one drawing, used the same way
everywhere, never redrawn or re-typed. The owner picked it on 2026-11-24
(concept A, "leaf dot").

**The idea:** the dot on the i is a kratom leaf, with its vein cut out. It reads
"ik" at 16 px and "kratom" when you look closer.

## The one drawing

| What | Where |
|---|---|
| Master file | `public/brand/ik-mark.svg` (served at `/brand/ik-mark.svg`) |
| The same path in code | `src/lib/brand-mark.ts` (`MARK_D`); a test keeps the two identical |
| Site header and mobile menu | `src/components/BrandMark.tsx` (inline SVG, takes the text color) |
| `/icon`, `/apple-icon` | `src/lib/brand-icon.tsx` |
| Link-preview cards | `src/lib/og-brand.tsx` (`OgBrand`), used by `og-card.tsx` and the state, meeting and alert cards |
| PNG icons, push badge, `favicon.ico` | `node scripts/brand-icons.mjs` writes them all from the master |
| Email headers | the 180 px PNG (`LOGO_URL` in `src/lib/email/letter-footer.ts`) |

Built on a 64-unit grid with 12-unit stems, so at 16 px every stem edge lands on
a whole pixel. It is a single path: the vein is a reverse-wound subpath, so it
cuts out with the default fill rule and no transform. Keep it that way. Every
renderer we use (browsers, sharp, the OG-image engine) then draws it the same.

**If the mark ever changes:** edit `public/brand/ik-mark.svg`, copy the new `d`
into `MARK_D`, run `node scripts/brand-icons.mjs`, and bump `CACHE_NAME` in
`public/sw.js` so installed apps fetch the new icons. Keep every file path the
same: installed apps, old emails and search engines point at them.

## Color

| Name | Hex | Use |
|---|---|---|
| Emerald | `#10B981` | The mark on dark grounds (the default) |
| Deep emerald | `#059669` | The mark on light grounds, where `#10B981` is too pale |
| Ink | `#0A0A0A` | The app-icon tile |
| White | `#FFFFFF` | Single-color uses: the push badge, embossing, one-color print |

One color at a time. The mark is never two-tone, never a gradient, never
outlined.

## Lockup

The mark, then the wordmark **iKratom** with the i in emerald. The gap between
them is about a third of the mark's height. The site header uses the mark at
24 px next to 18 px type.

The mark can stand alone (icons, favicons, stickers, avatars). The wordmark
never appears without the mark in a header.

## Clear space and size

- Leave clear space on every side of at least the width of the i stem (12 of the
  64 units).
- Smallest size: 16 px on screen, 6 mm in print.
- On an app tile, the mark sits at 72% of the tile; on Android's maskable icon,
  56%, so a circular crop never clips it.

## Don't

- Don't type the mark in a font, or rebuild it from letters. Always use the drawing.
- Don't stretch, rotate, skew or re-proportion it.
- Don't swap the leaf for a plain dot, or turn the leaf's vein into a stroke.
- Don't add shadows, outlines, glows or gradients.
- Don't put the emerald mark on a busy photo or a ground too close to its color.
  Use the white version instead.
- Don't use it for another organization's material, or to imply that an
  organization endorses iKratom.
