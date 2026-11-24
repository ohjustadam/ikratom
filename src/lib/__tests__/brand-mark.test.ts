import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { MARK_D, markSvg } from "../brand-mark";
import { LOGO_URL } from "../email/letter-footer";
import { EMAIL_LOGO_URL } from "../../../scripts/lib/email-render.mjs";

// docs/BRAND.md: one drawing of the "ik" mark, every surface drawn from it.
const MASTER = "public/brand/ik-mark.svg";

describe("the ik mark", () => {
  const master = readFileSync(MASTER, "utf8");

  it("the code copy is the master drawing, character for character", () => {
    const d = master.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
    expect(d).toBeTruthy();
    expect(MARK_D).toBe(d);
  });

  it("the master stays one path with no fill-rule or transform, so every renderer cuts the vein the same", () => {
    expect(master.match(/<path\b/g)).toHaveLength(1);
    expect(master).not.toMatch(/fill-rule|transform=/);
    expect(markSvg("#fff")).toContain(MARK_D);
  });

  it("every raster copy exists at its published path", () => {
    const files = [
      "public/ikratom-icon-180.png",
      "public/ikratom-icon-192.png",
      "public/ikratom-icon-512.png",
      "public/ikratom-icon-512-maskable.png",
      "public/ikratom-icon-1024.png",
      "public/badge.png",
      "src/app/favicon.ico",
    ];
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("the push badge is a transparent glyph, not an opaque square", async () => {
    const { data, info } = await sharp("public/badge.png").raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) opaque++;
    const share = opaque / (info.width * info.height);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.6);
  });

  it("the header and the mobile menu draw the mark, not a typed stand-in", () => {
    for (const f of ["src/app/layout.tsx", "src/components/MobileNav.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("<BrandMark");
    }
    for (const f of ["src/app/icon.tsx", "src/app/apple-icon.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("brandIconResponse");
    }
  });

  it("both email renderers show the same logo file", () => {
    expect(EMAIL_LOGO_URL).toBe(LOGO_URL);
  });
});
