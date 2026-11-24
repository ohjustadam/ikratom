#!/usr/bin/env node
/**
 * make-push-badge.mjs — writes public/badge.png, the small icon Android shows in
 * the status bar for an iKratom push notification.
 *
 * Android draws that badge from the image's ALPHA channel only, in white. The
 * app icon (/icon) is a fully opaque black square, so as a badge it came out as
 * a plain white square (member report 2026-11-23). This is the same "iK" glyph
 * as src/app/icon.tsx, white on transparent, so the glyph's shape shows.
 *
 *   node scripts/make-push-badge.mjs
 */
import sharp from "sharp";

const OUT = "public/badge.png";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <text x="48" y="50" text-anchor="middle" dominant-baseline="central"
    font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="62" letter-spacing="-3"
    fill="#ffffff">iK</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT);

// A badge that is mostly opaque is the bug coming back: say so.
const { data, info } = await sharp(OUT).raw().toBuffer({ resolveWithObject: true });
let opaque = 0;
for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] > 128) opaque++;
const share = opaque / (info.width * info.height);
console.log(`${OUT}: ${info.width}x${info.height}, ${info.channels} channels, ${(share * 100).toFixed(0)}% opaque`);
if (info.channels !== 4 || share > 0.6 || share < 0.05) {
  console.error("badge must be a transparent PNG with a visible glyph");
  process.exit(1);
}
