/**
 * The robustness layer of the free AI router (owner, 2026-10-27): size-aware
 * routing, model tiers, extra provider slots, hedging, cache keys, and the
 * guarantee that unit tests never touch the production database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  estimateTokens, fitsProvider, chunkText, tierModel, laneOf, extraProviders, hedge, cacheKey,
  loadProviderHealth, saveProviderHealth, readCache,
} from "../scripts/lib/ai-router-support.mjs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("size-aware routing", () => {
  it("estimates ~4 chars per token across texts", () => {
    expect(estimateTokens("abcd", "efgh")).toBe(2);
  });
  it("keeps prompts inside Groq's per-request budget, and lets the env override it", () => {
    expect(fitsProvider("groq", 6_000, 1_200, {})).toBe(true);
    expect(fitsProvider("groq", 7_000, 1_200, {})).toBe(false);
    expect(fitsProvider("groq", 7_000, 1_200, { AI_BUDGET_GROQ: "20000" })).toBe(true);
    expect(fitsProvider("gemini", 500_000, 2_000, {})).toBe(true);
  });
  it("chunks long text under the limit without losing words", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ` + "word ".repeat(60)).join("\n\n");
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
    expect(chunks.join(" ").split(/\s+/).filter(Boolean).length).toBe(text.split(/\s+/).filter(Boolean).length);
  });
});

describe("model tiers", () => {
  it("leaves the large model alone unless asked for small", () => {
    expect(tierModel("groq", "large", "openai/gpt-oss-120b", {})).toBe("openai/gpt-oss-120b");
    expect(tierModel("groq", "small", "openai/gpt-oss-120b", {})).toBe("openai/gpt-oss-20b");
    expect(tierModel("groq", "small", "x", { GROQ_MODEL_SMALL: "qwen/qwen3-8b" })).toBe("qwen/qwen3-8b");
    expect(tierModel("nvidia", "small", "big-model", {})).toBe("big-model");
  });
  it("gives members Groq's spare model, and every other provider its usual one", () => {
    expect(tierModel("groq", "member", "openai/gpt-oss-120b", {})).toBe("openai/gpt-oss-20b");
    expect(tierModel("groq", "member", "x", { GROQ_MODEL_MEMBER: "qwen/qwen3.8-27b" })).toBe("qwen/qwen3.8-27b");
    expect(tierModel("mistral", "member", "mistral-small-latest", {})).toBe("mistral-small-latest");
    expect(laneOf("groq", "member")).toBe("groq:member");
    expect(laneOf("groq", "large")).toBe("groq");
    expect(laneOf("mistral", "member")).toBe("mistral");
  });
});

describe("extra provider slots", () => {
  it("adds OpenAI-compatible hosts from env alone, keyless allowed", () => {
    const x = extraProviders({
      AI_EXTRA_1_URL: "https://api.example.ai/v1/", AI_EXTRA_1_MODEL: "m1", AI_EXTRA_1_NAME: "Example",
      AI_EXTRA_2_URL: "https://h2.ai/v1/chat/completions", AI_EXTRA_2_MODEL: "m2", AI_EXTRA_2_KEY: "k2", AI_EXTRA_2_NAME: "bad name!",
      AI_EXTRA_3_URL: "https://no-model.ai/v1",
    });
    expect(x).toEqual([
      { name: "example", url: "https://api.example.ai/v1/chat/completions", key: null, model: "m1" },
      { name: "extra2", url: "https://h2.ai/v1/chat/completions", key: "k2", model: "m2" },
    ]);
  });
});

describe("hedge", () => {
  it("never starts the second call when the first answers in time", async () => {
    const second = vi.fn(async () => "B");
    await expect(hedge(async () => "A", second, 50)).resolves.toBe("A");
    await sleep(80);
    expect(second).not.toHaveBeenCalled();
  });
  it("takes the second when the first is slow", async () => {
    await expect(hedge(async () => { await sleep(200); return "A"; }, async () => "B", 20)).resolves.toBe("B");
  });
  it("falls back at once when the first fails fast", async () => {
    const t = Date.now();
    await expect(hedge(async () => { throw new Error("a"); }, async () => "B", 5_000)).resolves.toBe("B");
    expect(Date.now() - t).toBeLessThan(1_000);
  });
  it("rejects with the first error only when both fail", async () => {
    await expect(hedge(async () => { throw new Error("first"); }, async () => { throw new Error("second"); }, 10)).rejects.toThrow("first");
  });
});

describe("cache keys", () => {
  it("are stable and separate tiers", () => {
    const a = cacheKey({ systemPrompt: "s", userPrompt: "u", maxTokens: 10 });
    expect(a).toBe(cacheKey({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, tier: "large" }));
    expect(a).not.toBe(cacheKey({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, tier: "small" }));
  });
});

describe("persistence is off in unit tests", () => {
  it("never calls the database under vitest without an explicit opt-in", async () => {
    const spy = vi.fn();
    const real = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    const env = { VITEST: "true", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
    expect((await loadProviderHealth(env)).size).toBe(0);
    expect(await saveProviderHealth("groq@gha", Date.now() + 1000, "t", env)).toBe(false);
    expect(await readCache("k", env)).toBeNull();
    globalThis.fetch = real;
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── End to end through aiRouter, with fetch mocked ───────────────────────────
const REAL_PROVIDER_ENV = /^(AI_GATEWAY_API_KEY|AI_PROVIDER_ORDER|AI_EXTRA_\d_\w+|CEREBRAS_API_KEY|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_AI_TOKEN|GEMINI_API_KEY(_\d+)?|GH_MODELS_TOKEN|GITHUB_MODELS_TOKEN|GROQ_API_KEY|MISTRAL_API_KEY|NVIDIA_API_KEY|OPENROUTER_API_KEY|SAMBANOVA_API_KEY)$/;
const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.unstubAllEnvs();
  for (const k of Object.keys(process.env)) if (REAL_PROVIDER_ENV.test(k)) vi.stubEnv(k, "");
});
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });

async function loadRouter(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("../scripts/lib/ai-router.mjs");
}
const ok = (body: object) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }) });

describe("aiRouter with the new options", () => {
  it("hedges: a slow first provider loses to a fast second one", async () => {
    const { aiRouter } = await loadRouter({ GROQ_API_KEY: "g", MISTRAL_API_KEY: "m", AI_PROVIDER_ORDER: "groq,mistral" });
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("groq")) { await sleep(400); return ok({ who: "groq" }); }
      return ok({ who: "mistral" });
    }) as unknown as typeof fetch;
    const r = await aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 50, verbose: false, hedgeMs: 30, maxWaitMs: 0 });
    expect(r.provider).toBe("mistral");
  });

  it("routes an oversized prompt past Groq instead of paying for a 413", async () => {
    const { aiRouter } = await loadRouter({ GROQ_API_KEY: "g", MISTRAL_API_KEY: "m", AI_PROVIDER_ORDER: "groq,mistral" });
    const hits: string[] = [];
    globalThis.fetch = (async (url: string) => { hits.push(String(url)); return ok({ fine: true }); }) as unknown as typeof fetch;
    const r = await aiRouter({ systemPrompt: "s", userPrompt: "x".repeat(40_000), maxTokens: 1_000, verbose: false, maxWaitMs: 0 });
    expect(r.provider).toBe("mistral");
    expect(hits.some((h) => h.includes("groq"))).toBe(false);
  });

  it("says PROMPT_TOO_LARGE when no configured provider can take it", async () => {
    const { aiRouter } = await loadRouter({ GROQ_API_KEY: "g", AI_PROVIDER_ORDER: "groq", OLLAMA_URL: "http://127.0.0.1:1" });
    globalThis.fetch = (async () => { throw new Error("fetch failed"); }) as unknown as typeof fetch;
    await expect(aiRouter({ systemPrompt: "s", userPrompt: "x".repeat(40_000), maxTokens: 1_000, verbose: false, maxWaitMs: 0 }))
      .rejects.toThrow();
  });

  it("calls a keyless extra host without an Authorization header", async () => {
    const { aiRouter, listAvailableProviders } = await loadRouter({
      AI_EXTRA_1_URL: "https://free.example/v1", AI_EXTRA_1_MODEL: "tiny", AI_EXTRA_1_NAME: "freehost", AI_PROVIDER_ORDER: "freehost",
    });
    expect(listAvailableProviders()).toContain("freehost");
    let auth: string | undefined = "unset";
    globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      auth = init.headers.Authorization;
      return ok({ hi: 1 });
    }) as unknown as typeof fetch;
    const r = await aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 20, verbose: false, maxWaitMs: 0 });
    expect(r.provider).toBe("freehost");
    expect(auth).toBeUndefined();
  });
});
