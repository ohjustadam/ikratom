/**
 * Member photo metadata stripping (src/lib/image-strip.ts). A geotagged photo
 * from a member in a kratom-ban state must never reach storage with its GPS.
 *
 * Two layers: hand-built containers that plant metadata in every place the
 * stripper must look, and, when sharp is installed (it is, as Next's optional
 * dependency, locally and in CI), REAL encoded photos carrying GPS EXIF, which
 * must still decode after stripping and report no EXIF/XMP/ICC at all.
 */
import { describe, it, expect } from "vitest";
import { stripImageMetadata, detectImageKind } from "@/lib/image-strip";

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) { o.set(x, i); i += x.length; }
  return o;
};
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, "latin1"));
const seg = (marker: number, data: Uint8Array) => cat(Uint8Array.of(0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff), data);

describe("JPEG", () => {
  const jfif = seg(0xe0, cat(enc("JFIF\0"), Uint8Array.of(1, 1, 0, 0, 1, 0, 1, 0, 0)));
  const exif = seg(0xe1, cat(enc("Exif\0\0"), enc("GPSLatitude 35.4676 N GPSLongitude 97.5164 W")));
  const xmp = seg(0xe1, enc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Midwest City, OK</x:xmpmeta>"));
  const iptc = seg(0xed, enc("Photoshop 3.0\0 8BIM city=Tulsa"));
  const com = seg(0xfe, enc("shot at 123 Main St"));
  const sof = seg(0xc0, Uint8Array.of(8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1));
  const sos = seg(0xda, Uint8Array.of(3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0));
  const file = cat(Uint8Array.of(0xff, 0xd8), jfif, exif, xmp, iptc, com, sof, sos, Uint8Array.of(0x12, 0x34, 0xff, 0x00, 0x56), Uint8Array.of(0xff, 0xd9));

  it("drops EXIF, XMP, IPTC and comments, keeps the image segments", () => {
    const r = stripImageMetadata(file);
    if (!r.ok) throw new Error(r.reason);
    for (const s of ["Exif", "GPS", "xmpmeta", "Midwest", "8BIM", "Tulsa", "Main St"]) expect(has(r.bytes, s)).toBe(false);
    expect(has(r.bytes, "JFIF")).toBe(true);
    expect([r.width, r.height]).toEqual([640, 480]);
    expect(r.contentType).toBe("image/jpeg");
    expect(Array.from(r.bytes.slice(-2))).toEqual([0xff, 0xd9]);
  });

  it("refuses a truncated file", () => {
    expect(stripImageMetadata(file.slice(0, 30)).ok).toBe(false);
  });
});

describe("PNG", () => {
  const chunk = (type: string, data: Uint8Array) =>
    cat(Uint8Array.of(0, 0, data.length >> 8, data.length & 0xff), enc(type), data, Uint8Array.of(0, 0, 0, 0));
  const ihdr = chunk("IHDR", Uint8Array.of(0, 0, 1, 0, 0, 0, 0, 200, 8, 6, 0, 0, 0));
  const file = cat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ihdr, chunk("tEXt", enc("Location\0Oklahoma City")), chunk("eXIf", enc("GPS 35.4")),
    chunk("iTXt", enc("Author\0\0\0\0\0Jane Doe")), chunk("tIME", Uint8Array.of(7, 234, 10, 24, 1, 2, 3)),
    chunk("prVt", enc("hidden payload")), chunk("IDAT", Uint8Array.of(1, 2, 3)), chunk("IEND", new Uint8Array()),
  );

  it("keeps only rendering chunks", () => {
    const r = stripImageMetadata(file);
    if (!r.ok) throw new Error(r.reason);
    for (const s of ["tEXt", "Oklahoma", "eXIf", "iTXt", "Jane", "tIME", "prVt", "hidden"]) expect(has(r.bytes, s)).toBe(false);
    for (const s of ["IHDR", "IDAT", "IEND"]) expect(has(r.bytes, s)).toBe(true);
    expect([r.width, r.height]).toEqual([256, 200]);
  });
});

describe("WebP", () => {
  const chunk = (fourcc: string, data: Uint8Array) => {
    const n = data.length;
    return cat(enc(fourcc), Uint8Array.of(n & 0xff, (n >> 8) & 0xff, 0, 0), data, n & 1 ? Uint8Array.of(0) : new Uint8Array());
  };
  // VP8X: flags EXIF|XMP|ICC set, canvas 300x150 (stored minus one).
  const vp8x = chunk("VP8X", Uint8Array.of(0x2c, 0, 0, 0, 43, 1, 0, 149, 0, 0));
  const body = cat(vp8x, chunk("ICCP", enc("profile")), chunk("VP8 ", Uint8Array.of(0, 0, 0, 0x9d, 1, 0x2a, 44, 1, 150, 0)),
    chunk("EXIF", enc("GPS 35.4676")), chunk("XMP ", enc("<x:xmpmeta>Tulsa</x:xmpmeta>")));
  const n = body.length + 4;
  const file = cat(enc("RIFF"), Uint8Array.of(n & 0xff, (n >> 8) & 0xff, 0, 0), enc("WEBP"), body);

  it("drops EXIF/XMP/ICC chunks, clears their flags and fixes the RIFF size", () => {
    const r = stripImageMetadata(file);
    if (!r.ok) throw new Error(r.reason);
    for (const s of ["EXIF", "GPS", "XMP ", "Tulsa", "ICCP"]) expect(has(r.bytes, s)).toBe(false);
    expect(r.bytes[20] & 0x2c).toBe(0); // VP8X flags byte
    expect(r.bytes[4] | (r.bytes[5] << 8)).toBe(r.bytes.length - 8);
    expect([r.width, r.height]).toEqual([300, 150]);
  });
});

describe("refusals", () => {
  it("refuses GIF, SVG, BMP and unknown bytes", () => {
    for (const s of ["GIF89a........", "<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "BM............", "hello world!!"]) {
      const b = enc(s);
      expect(detectImageKind(b)).toBeNull();
      expect(stripImageMetadata(b).ok).toBe(false);
    }
  });
});

// Real photos with GPS, encoded by libvips (sharp), when it can load here.
const sharp = await import("sharp").then((m) => m.default).catch(() => null);

describe.skipIf(!sharp)("real encoded photos with GPS EXIF", () => {
  const gps = {
    IFD0: { Make: "Phone", Model: "Model X", Copyright: "Jane Doe" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 28/1 3/1", GPSLongitudeRef: "W", GPSLongitude: "97/1 30/1 59/1" },
  };
  for (const format of ["jpeg", "png", "webp"] as const) {
    it(`${format}: decodes after stripping and carries no EXIF/XMP/ICC`, async () => {
      const src = await sharp!({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 140, b: 90 } } })
        .withExif(gps)
        .toFormat(format)
        .toBuffer();
      const before = await sharp!(src).metadata();
      expect(before.exif, "fixture must actually carry EXIF").toBeTruthy();

      const r = stripImageMetadata(new Uint8Array(src));
      if (!r.ok) throw new Error(r.reason);
      expect([r.width, r.height]).toEqual([64, 48]);
      expect(has(r.bytes, "Jane Doe")).toBe(false);
      const after = await sharp!(Buffer.from(r.bytes)).metadata();
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect([after.width, after.height]).toEqual([64, 48]);
      const { info } = await sharp!(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(64);
    });
  }
});
