/**
 * Regression tests for member-facing AI calls (Personalize), found live on
 * 2026-10-31 when a member reported it failing "dozens" of times in two days.
 *
 * What was measured: the background jobs had spent gpt-oss-120b's daily Groq
 * allowance (198,983 of 200,000 tokens) while gpt-oss-20b sat idle. Groq meters
 * each model on its own, so the fix is a "member" lane: its own Groq model, and
 * its own cooldown, so a throttle on the jobs' model cannot park it. With every
 * other provider also throttled, the router threw in under a second and showed
 * the member NVIDIA's `404 Function not found`, which was not a hard failure.
 *
 * Each behaviour below is checked against the shape that failed, so these tests
 * fail if the lane collapses back into one cooldown per provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PROVIDER_ENV = { GROQ_API_KEY: "test-groq", MISTRAL_API_KEY: "test-mistral" };

async function loadRouter(extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ AI_ROUTER_MAX_WAIT_MS: "0", ...PROVIDER_ENV, ...extraEnv })) vi.stubEnv(k, v);
  return import("../scripts/lib/ai-router.mjs");
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });
// tests/setup.ts loads .env.local; blank every real provider key so each test
// sees exactly the pool it sets up (see ai-router-throttle.test.ts).
const REAL_PROVIDER_ENV = /^(AI_GATEWAY_API_KEY|AI_PROVIDER_ORDER|CEREBRAS_API_KEY|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_AI_TOKEN|GEMINI_API_KEY(_\d+)?|GH_MODELS_TOKEN|GITHUB_MODELS_TOKEN|GROQ_API_KEY|MISTRAL_API_KEY|NVIDIA_API_KEY|OPENROUTER_API_KEY|SAMBANOVA_API_KEY|GROQ_MODEL(_SMALL|_MEMBER)?)$/;
beforeEach(() => {
  vi.unstubAllEnvs();
  for (const k of Object.keys(process.env)) if (REAL_PROVIDER_ENV.test(k)) vi.stubEnv(k, "");
});

const ok = (content: object) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
});
const status = (s: number, body = "nope") => ({ ok: false, status: s, text: async () => body, json: async () => ({}) });

type Call = { host: string; model?: string; reasoning?: string };
function mockFetch(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const b = init?.body ? JSON.parse(init.body) : {};
    const c: Call = { host: new URL(u).hostname, model: b.model, reasoning: b.reasoning_effort };
    calls.push(c);
    if (c.host === "127.0.0.1" || c.host === "localhost") throw new Error("ECONNREFUSED");
    return answer(c);
  }) as unknown as typeof fetch;
  return calls;
}
// The router's JSDoc types its optional fields from their defaults (null), so a
// test that passes real overrides calls it loosely.
type LooseRouter = (o: object) => Promise<{ provider: string }>;
const call = (aiRouter: unknown, o: object = {}) =>
  (aiRouter as LooseRouter)({ systemPrompt: "s", userPrompt: "u", maxTokens: 50, verbose: false, ...o });

describe("member lane", () => {
  it("gives members gpt-oss-20b on Groq, and low reasoning when asked", async () => {
    const { aiRouter } = await loadRouter();
    const calls = mockFetch(() => ok({ personalized_body: "x" }));
    const r = await call(aiRouter, { tier: "member", hedgeMs: 3_000, reasoningEffort: "low" });
    expect(r.provider).toBe("groq");
    expect(calls[0]).toMatchObject({ host: "api.groq.com", model: "openai/gpt-oss-20b", reasoning: "low" });
  });

  it("is not parked by a throttle on the jobs' model", async () => {
    const { aiRouter } = await loadRouter();
    const calls = mockFetch((c) =>
      c.host === "api.groq.com" && c.model === "openai/gpt-oss-120b" ? status(429, "tokens per day (TPD)") :
      c.host === "api.groq.com" ? ok({ a: 1 }) : status(429));
    // A background-style call throttles Groq's main model (and Mistral)...
    await call(aiRouter).catch(() => undefined);
    const before = calls.length;
    // ...and a member's call still reaches Groq, on its own model.
    const r = await call(aiRouter, { tier: "member", hedgeMs: 3_000 });
    expect(r.provider).toBe("groq");
    expect(calls.slice(before)[0]).toMatchObject({ host: "api.groq.com", model: "openai/gpt-oss-20b" });
  });

  it("does not hand the jobs' model the member lane's park either", async () => {
    const { aiRouter } = await loadRouter();
    const calls = mockFetch((c) =>
      c.host === "api.groq.com" && c.model === "openai/gpt-oss-20b" ? status(429) :
      c.host === "api.groq.com" ? ok({ a: 1 }) : status(500));
    await call(aiRouter, { tier: "member", hedgeMs: 3_000 }).catch(() => undefined);
    const before = calls.length;
    const r = await call(aiRouter);
    expect(r.provider).toBe("groq");
    expect(calls.slice(before)[0]).toMatchObject({ model: "openai/gpt-oss-120b" });
  });
});

describe("a member waiting on a throttled pool", () => {
  it("tries a provider parked by an EARLIER request once, instead of failing at once", async () => {
    const { aiRouter } = await loadRouter();
    let mistralCalls = 0;
    let throttle = true;
    mockFetch((c) => {
      if (c.host === "api.mistral.ai") { mistralCalls++; return throttle ? status(429) : ok({ a: 1 }); }
      return status(429);
    });
    // Earlier traffic parks every provider for 60 s.
    await call(aiRouter).catch(() => undefined);
    await call(aiRouter, { tier: "member" }).catch(() => undefined);
    const parked = mistralCalls;
    throttle = false; // the per-minute budget refills well inside the park
    const r = await call(aiRouter, { tier: "member", hedgeMs: 3_000 });
    expect(r.provider).toBe("mistral");
    expect(mistralCalls).toBe(parked + 1);
  });

  it("leaves a background call's behaviour alone: no retry of parked providers", async () => {
    const { aiRouter } = await loadRouter();
    let sent = 0;
    mockFetch(() => { sent++; return status(429); });
    await call(aiRouter).catch(() => undefined);
    const after = sent;
    await call(aiRouter).catch(() => undefined);
    expect(sent).toBe(after);
  });
});

describe("a provider's own default model answering 404", () => {
  it("is dropped like a 410, so no later call pays for it", async () => {
    const { aiRouter } = await loadRouter({ GROQ_API_KEY: "", NVIDIA_API_KEY: "test-nvidia" });
    let nvidia = 0;
    mockFetch((c) => {
      if (c.host === "integrate.api.nvidia.com") { nvidia++; return status(404, "Function not found for account"); }
      return ok({ a: 1 });
    });
    for (let i = 0; i < 4; i++) await call(aiRouter, { providerOverride: "nvidia" }).catch(() => undefined);
    expect(nvidia).toBe(1);
  });

  it("is NOT fatal when the caller chose the model", async () => {
    const { aiRouter } = await loadRouter({ GROQ_API_KEY: "", NVIDIA_API_KEY: "test-nvidia" });
    let nvidia = 0;
    mockFetch((c) => {
      if (c.host === "integrate.api.nvidia.com") { nvidia++; return status(404, "model not found"); }
      return ok({ a: 1 });
    });
    for (let i = 0; i < 3; i++) {
      await call(aiRouter, { providerOverride: "nvidia", modelOverride: "some/other-model" }).catch(() => undefined);
    }
    expect(nvidia).toBe(3);
  });
});
