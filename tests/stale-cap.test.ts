import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The stale-page cap (owner decision 2026-10-13): no cached page is served
 * more than ~2 h old. Proven with Next's own header builder, so a Next upgrade
 * that changes the arithmetic shows up here.
 */
const require = createRequire(import.meta.url);
const { getCacheControlHeader } = require("next/dist/server/lib/cache-control.js") as {
  getCacheControlHeader: (o: { revalidate: number | false; expire?: number }) => string;
};

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const expire = Number(config.match(/^\s*expireTime:\s*(\d+)/m)?.[1]);

describe("expireTime", () => {
  it("is set to two hours (Next's default is a year)", () => {
    expect(expire).toBe(7200);
  });

  it("a 15-minute page may be served stale for at most 1 h 45 m", () => {
    expect(getCacheControlHeader({ revalidate: 900, expire })).toBe("s-maxage=900, stale-while-revalidate=6300");
  });

  it("an hourly page may be served stale for at most 1 h", () => {
    expect(getCacheControlHeader({ revalidate: 3600, expire })).toBe("s-maxage=3600, stale-while-revalidate=3600");
  });

  it("a page whose window is longer than the cap is never served stale at all", () => {
    expect(getCacheControlHeader({ revalidate: 86400, expire })).toBe("s-maxage=86400");
  });
});
