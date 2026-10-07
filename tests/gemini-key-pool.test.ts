/**
 * gemini-key-pool.test.ts — one refused Gemini key must not sink the others.
 *
 * 2026-10-07: the primary key's project ran out of prepaid credit (402) and the
 * router marked ALL of Gemini dead for the run, so the owner's new working key
 * (GEMINI_API_KEY_2) was never tried.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

beforeEach(() => {
  vi.resetModules();
  process.env.GEMINI_API_KEYS = "";
  process.env.GEMINI_API_KEY = "﻿dead-key\n";
  process.env.GEMINI_API_KEY_2 = "live-key";
});

describe("gemini key pool", () => {
  it("skips a dead key and keeps serving the live one", async () => {
    const pool = await import("../scripts/lib/gemini-keys.mjs");
    expect(pool.geminiKeyCount()).toBe(2);
    pool.markGeminiKeyDead("dead-key");
    expect(pool.liveGeminiKeyCount()).toBe(1);
    for (let i = 0; i < 4; i++) expect(pool.pickGeminiKey()).toBe("live-key");
  });

  it("strips a byte-order mark and whitespace from pasted keys", async () => {
    const pool = await import("../scripts/lib/gemini-keys.mjs");
    const seen = new Set([pool.pickGeminiKey(), pool.pickGeminiKey()]);
    expect(seen).toEqual(new Set(["dead-key", "live-key"]));
  });

  it("returns no key once every key is dead", async () => {
    const pool = await import("../scripts/lib/gemini-keys.mjs");
    pool.markGeminiKeyDead("dead-key");
    pool.markGeminiKeyDead("live-key");
    expect(pool.pickGeminiKey()).toBeNull();
  });

  it("the router treats a refusal as the key's fault and tries the next key", () => {
    const src = fs.readFileSync("scripts/lib/ai-router.mjs", "utf8");
    expect(src).toMatch(/GEMINI_KEY_REFUSED = new Set\(\[400, 401, 402, 403, 404\]\)/);
    expect(src).toMatch(/markGeminiKeyDead\(key\)/);
    expect(src).toMatch(/process\.env\.GEMINI_MODEL \|\| "gemini-flash-lite-latest"/);
  });
});
