/**
 * Strip every metadata block from a member photo, in pure JS (no IO, no native
 * deps), and read its dimensions. B4b social profiles, 2026-10-24.
 *
 * WHY: some members live in states where kratom is banned. A phone photo's EXIF
 * carries GPS coordinates, the device serial and the capture time; XMP and IPTC
 * can carry names and places. The browser re-encodes through a canvas first
 * (which drops metadata), but that runs on the member's device and can be
 * skipped, so THIS is the authoritative pass, on the server, before storage.
 *
 * Pure JS rather than sharp on purpose: deterministic, unit-tested, and no
 * Linux-binary risk in Netlify's function bundle. It never decodes pixels: it
 * walks the container and keeps only what is needed to draw the image.
 *
 *   JPEG  keeps SOI, a plain JFIF APP0, DQT/DHT/SOF/DRI/SOS + scan data, EOI.
 *         Drops APP1–APP15 (EXIF, XMP, ICC, IPTC, Photoshop…), COM, JFXX.
 *   PNG   keeps an allowlist of rendering chunks. Drops eXIf, tEXt, iTXt, zTXt,
 *         tIME, iCCP and every unknown or private chunk.
 *   WebP  drops EXIF, XMP and ICCP chunks and clears their VP8X flag bits.
 *
 * Anything else (GIF, SVG, HEIC, BMP…) is refused, never passed through.
 */

export type ImageKind = "image/jpeg" | "image/png" | "image/webp";

export type StripResult =
  | { ok: true; bytes: Uint8Array; contentType: ImageKind; width: number; height: number }
  | { ok: false; reason: string };

export const MAX_DIMENSION = 8000;

export function detectImageKind(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

export function stripImageMetadata(input: Uint8Array): StripResult {
  const kind = detectImageKind(input);
  try {
    const r =
      kind === "image/jpeg" ? stripJpeg(input)
      : kind === "image/png" ? stripPng(input)
      : kind === "image/webp" ? stripWebp(input)
      : null;
    if (!r) return { ok: false, reason: "Only JPEG, PNG or WebP photos are accepted." };
    if ("reason" in r) return { ok: false, reason: r.reason };
    if (!(r.width > 0 && r.height > 0)) return { ok: false, reason: "Could not read the image size." };
    if (r.width > MAX_DIMENSION || r.height > MAX_DIMENSION) {
      return { ok: false, reason: `Images can be at most ${MAX_DIMENSION} pixels on a side.` };
    }
    return { ok: true, bytes: r.bytes, contentType: kind!, width: r.width, height: r.height };
  } catch {
    return { ok: false, reason: "The image file is damaged or truncated." };
  }
}

type Inner = { bytes: Uint8Array; width: number; height: number } | { reason: string };

// ---- JPEG ------------------------------------------------------------------
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function stripJpeg(b: Uint8Array): Inner {
  const out: Uint8Array[] = [b.subarray(0, 2)]; // SOI
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) return { reason: "The JPEG structure is invalid." };
    while (b[i] === 0xff) i++; // fill bytes
    const marker = b[i++];
    if (marker === 0xd9) { out.push(Uint8Array.of(0xff, 0xd9)); break; } // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(Uint8Array.of(0xff, marker)); continue; }
    if (i + 2 > b.length) return { reason: "The JPEG is truncated." };
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return { reason: "The JPEG is truncated." };
    const seg = b.subarray(i - 2, i + len); // FF marker len data
    const data = b.subarray(i + 2, i + len);
    if (SOF.has(marker) && data.length >= 5) {
      height = (data[1] << 8) | data[2];
      width = (data[3] << 8) | data[4];
    }
    const keep =
      marker === 0xe0 ? ascii(data, 0, 5) === "JFIF\0" && data.length <= 16 // plain JFIF, no thumbnail
      : (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe ? false     // APP1-15, COM
      : true;
    if (keep) out.push(seg);
    i += len;
    if (marker === 0xda) {
      // Entropy-coded scan data runs to EOI; markers inside it (RSTn, more
      // SOS in progressive files) are kept verbatim. Metadata never lives here.
      out.push(b.subarray(i));
      break;
    }
  }
  return { bytes: concat(out), width, height };
}

// ---- PNG -------------------------------------------------------------------
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "pHYs", "sBIT", "bKGD"]);

function stripPng(b: Uint8Array): Inner {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return { reason: "The PNG is truncated." };
    if (type === "IHDR") { width = u32be(b, i + 8); height = u32be(b, i + 12); }
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  if (!sawEnd) return { reason: "The PNG is truncated." };
  return { bytes: concat(out), width, height };
}

// ---- WebP ------------------------------------------------------------------
const WEBP_DROP = new Set(["EXIF", "XMP ", "ICCP"]);
const VP8X_META_FLAGS = 0x20 | 0x08 | 0x04; // ICC | EXIF | XMP

function stripWebp(b: Uint8Array): Inner {
  const chunks: Uint8Array[] = [];
  let i = 12;
  let width = 0;
  let height = 0;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const padded = size + (size & 1);
    const end = i + 8 + padded;
    if (i + 8 + size > b.length) return { reason: "The WebP is truncated." };
    const data = b.subarray(i + 8, i + 8 + size);
    if (fourcc === "VP8X" && size >= 10) {
      width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
      height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
      const copy = b.slice(i, Math.min(end, b.length));
      copy[8] &= ~VP8X_META_FLAGS;
      chunks.push(copy);
    } else if (!WEBP_DROP.has(fourcc)) {
      if (!width && fourcc === "VP8 " && size >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
        width = (data[6] | (data[7] << 8)) & 0x3fff;
        height = (data[8] | (data[9] << 8)) & 0x3fff;
      } else if (!width && fourcc === "VP8L" && size >= 5 && data[0] === 0x2f) {
        const bits = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
      }
      chunks.push(b.subarray(i, Math.min(end, b.length)));
    }
    i = end;
  }
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const riffSize = 4 + body.length;
  head[4] = riffSize & 0xff; head[5] = (riffSize >>> 8) & 0xff; head[6] = (riffSize >>> 16) & 0xff; head[7] = (riffSize >>> 24) & 0xff;
  return { bytes: concat([head, body]), width, height };
}

// ---- helpers ---------------------------------------------------------------
function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let k = 0; k < n && at + k < b.length; k++) s += String.fromCharCode(b[at + k]);
  return s;
}
function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}
function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + ((b[at + 3] << 24) >>> 0);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
