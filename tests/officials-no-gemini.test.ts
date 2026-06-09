import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Acceptance pin for the de-Gemini work (private/LOCAL_REPS_DEGEMINI_PLAN.md):
 * the local-officials resolution path must NOT make any Gemini Google-Search
 * grounded call. We assert the call signatures of a grounded request
 * (google_search tool + generativelanguage endpoint + :generateContent) never
 * appear in these files. If a future change reintroduces grounding here, this
 * test fails before it can quietly re-consume the shared Gemini quota.
 */
const OFFICIALS_FILES = [
  "scripts/lib/officials-extract.mjs",
  "scripts/lib/officials-slate.mjs",
  "scripts/auto-fulfill-pending-local-reps.mjs",
  "scripts/seed-bill-officials.mjs",
  "scripts/extract-news-officials.mjs",
  "src/lib/ai/suggest-officials.ts",
  "src/lib/legistar-roster.ts",
];

// Real grounded-call fingerprints — NOT the word "Gemini" (allowed in prose).
const GROUNDING_TOKENS = /google_search|generativelanguage\.googleapis|:generateContent/;
// These officials files should no longer depend on the grounded-Gemini infra.
const GEMINI_INFRA_IMPORTS = /from\s+["'][^"']*(gemini-keys|grounding-budget)/;

describe("local-officials path is Gemini-grounding-free", () => {
  for (const file of OFFICIALS_FILES) {
    it(`${file} makes no Google-Search grounded call`, () => {
      const src = readFileSync(file, "utf8");
      expect(GROUNDING_TOKENS.test(src)).toBe(false);
    });
    it(`${file} does not import the grounded-Gemini infra`, () => {
      const src = readFileSync(file, "utf8");
      expect(GEMINI_INFRA_IMPORTS.test(src)).toBe(false);
    });
  }
});
