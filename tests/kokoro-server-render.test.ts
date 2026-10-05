/**
 * kokoro-server-render.test.ts — the CI brief renderer must not drop words.
 *
 * kokoro-js generate() tokenises with truncation:true at ~510 phoneme tokens: a
 * 176-word passage rendered as 26s of audio instead of ~74s, with no error.
 * stream(string) fixes that but never closes its splitter, so the LAST sentence
 * was held forever. scripts/lib/kokoro-tts.mjs streams a closed splitter.
 * (The browser player's twin check lives in tests/kokoro-splitter.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("scripts/lib/kokoro-tts.mjs", "utf8");

describe("CI brief renderer (scripts/lib/kokoro-tts.mjs)", () => {
  it("streams a closed splitter instead of calling the truncating generate()", () => {
    expect(src).not.toMatch(/tts\.generate\(/);
    expect(src).toMatch(/input\.close\(\);\s*\r?\n\s*for await \(const \{ audio \} of tts\.stream\(input/);
  });

  it("defaults to the reference fp32 weights", () => {
    expect(src).toMatch(/process\.env\.KOKORO_DTYPE \|\| "fp32"/);
  });
});
