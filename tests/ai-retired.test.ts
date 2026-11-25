import { describe, it, expect } from "vitest";
import { isRetired, RETIRED_PROVIDERS } from "../scripts/lib/ai-retired.mjs";

describe("retired AI providers", () => {
  it("skips a paid or shut-down provider by default", () => {
    expect(Object.keys(RETIRED_PROVIDERS).length).toBeGreaterThan(0);
    for (const name of Object.keys(RETIRED_PROVIDERS)) expect(isRetired(name, {})).toBe(true);
  });

  it("brings one back when AI_PROVIDER_ORDER names it", () => {
    expect(isRetired("mistral", { AI_PROVIDER_ORDER: "groq, Mistral" })).toBe(false);
    expect(isRetired("cerebras", { AI_PROVIDER_ORDER: "groq, Mistral" })).toBe(true);
  });

  it("never touches a live provider", () => {
    for (const name of ["groq", "gemini", "cloudflare", "nvidia", "openrouter", "ollama"]) {
      expect(isRetired(name, {})).toBe(false);
    }
  });
});
