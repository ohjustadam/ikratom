#!/usr/bin/env node
/**
 * brand-icons.mjs — renders every raster copy of the "ik" mark from the master
 * drawing, public/brand/ik-mark.svg. Run it after the mark changes, commit the
 * output. Usage rules: docs/BRAND.md.
 *
 *   node scripts/brand-icons.mjs
 *
 * Writes (paths are kept stable on purpose: installed apps, old emails and
 * Google's cached logo all point at them):
 *   public/ikratom-icon-{180,192,512,1024}.png   dark tile, full bleed (iOS and Android round the corners)
 *   public/ikratom-icon-512-maskable.png          mark inside Android's 80% safe circle
 *   public/badge.png                               white on transparent: Android's status-bar badge reads alpha only
 *   src/app/favicon.ico                            16/32/48, transparent, for browser tabs and Bing
 *
 * Replaces scripts/make-push-badge.mjs (2026-11-23), whose badge check lives on below.
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const EMERALD = "#10b981";
const INK = "#0a0a0a";

const master = readFileSync("public/brand/ik-mark.svg", "utf8");
const D = master.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
if (!D) throw new Error("public/brand/ik-mark.svg: no path d= found");

/** The mark on a 64-unit canvas, scaled about the centre, optionally on a square ground. */
function svg(px, { fill, ground = null, scale = 1 }) {
  const off = (64 - 64 * scale) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${px}" height="${px}">` +
      (ground ? `<rect width="64" height="64" fill="${ground}"/>` : "") +
      `<g transform="translate(${off} ${off}) scale(${scale})"><path fill="${fill}" d="${D}"/></g></svg>`,
  );
}
const png = (px, opts) => sharp(svg(px, opts)).png({ compressionLevel: 9 }).toBuffer();

const written = [];
async function out(path, buf) {
  writeFileSync(path, buf);
  written.push(`${path} (${buf.length} B)`);
}

// App and PWA icons: emerald mark at 72% on the ink tile, the same as /icon.
for (const px of [180, 192, 512, 1024]) {
  await out(`public/ikratom-icon-${px}.png`, await png(px, { fill: EMERALD, ground: INK, scale: 0.72 }));
}
// Maskable: Android may crop to a circle of 80% diameter, so the mark sits at 56%.
await out("public/ikratom-icon-512-maskable.png", await png(512, { fill: EMERALD, ground: INK, scale: 0.56 }));

// Push badge: white glyph on transparent, filling the canvas.
const badge = await png(96, { fill: "#ffffff", scale: 0.9 });
await out("public/badge.png", badge);
{
  const { data, info } = await sharp(badge).raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] > 128) opaque++;
  const share = opaque / (info.width * info.height);
  // A mostly opaque badge is the white-square bug (2026-11-23) coming back.
  if (info.channels !== 4 || share > 0.6 || share < 0.05) {
    console.error(`badge.png is ${(share * 100).toFixed(0)}% opaque: must be a transparent PNG with a visible glyph`);
    process.exit(1);
  }
}

// favicon.ico: PNG-in-ICO entries (supported by every current browser).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((px) => png(px, { fill: EMERALD })));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((px, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(px, e); // width
  header.writeUInt8(px, e + 1); // height
  header.writeUInt8(0, e + 2); // palette
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await out("src/app/favicon.ico", Buffer.concat([header, ...pngs]));

console.log(written.join("\n"));
