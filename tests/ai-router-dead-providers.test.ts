/**
 * Regression tests for the two ways a provider can be permanently broken while
 * still looking retryable — both found live on 2026-09-30, both of which had
 * the router paying full round-trips to something that could never answer.
 *
 *   1. HTTP 401. SambaNova had been recorded as "402, out of credit" when it
 *      was actually answering `{"code":"invalid_api_key"}` — "Incorrect API key
 *      provided: 98896d*****c200". 401 was not in HARD_FAIL_STATUS, so the
 *      provider stayed in the chain and one enrich-news run logged
 *      `sambanova 0/17`: seventeen calls to a key that cannot work, inside a
 *      job timeout, while the run reported `ai NONE-ANSWERED`.
 *
 *   2. HTTP 200 with a body that is not JSON. GitHub Models stopped returning
 *      410 and began answering 200 with the literal body `OK `. Every status
 *      check passed, `r.json()` threw a bare SyntaxError, and because that is an
 *      exception rather than a status nothing classified it — so it too was
 *      re-tried on every call. The fix is in readJsonOrDie(), shared by every
 *      provider caller, because six others had the same bare r.json().
 *
 * WHAT IS ASSERTED, AND WHY NOT HIT COUNTS. The observable difference between
 * "dead" and "throttled" is NOT how often a provider is called: a 429 starts a
 * 60-second cooldown, and pickStart() skips cooling providers, so inside one
 * test both look like a single attempt. The real difference is membership of
 * deadForProcess, which poolExhausted() reports — a dead pool stays dead for the
 * process, a cooling pool is expected to recover. The 429 case below is the
 * non-vacuity guard: without it, these tests would still pass if every failure
 * were treated as fatal, and the router would stop retrying providers that come
 * back in a minute.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/** Two cloud providers, so "the whole cloud pool is broken" is a real state. */
const PROVIDER_ENV = {
  GROQ_API_KEY: "test-groq",
  OPENROUTER_API_KEY: "test-openrouter",
};

/** Load a FRESH router module — it reads provider keys once at import time. */
async function loadRouter(extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROVIDER_ENV, ...extraEnv })) vi.stubEnv(k, v);
  return import("../scripts/lib/ai-router.mjs");
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });
beforeEach(() => { vi.unstubAllEnvs(); });

const CLOUD_HOSTS = ["api.groq.com", "openrouter.ai"];

/**
 * Point every cloud provider at the same failure and make five calls.
 * Returns how many cloud requests were actually sent, plus whether the router
 * now considers the pool dead.
 */
async function allCloudProvidersFail(response: () => unknown, calls = 5) {
  const { aiRouter, poolExhausted } = await loadRouter({ AI_ROUTER_MAX_WAIT_MS: "0" });

  let cloudRequests = 0;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (CLOUD_HOSTS.some((h) => u.includes(h))) {
      cloudRequests++;
      return response();
    }
    throw new Error("ECONNREFUSED"); // ollama — never reachable in a test
  }) as unknown as typeof fetch;

  for (let i = 0; i < calls; i++) {
    await aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, verbose: false })
      .catch(() => undefined);
  }
  return { cloudRequests, exhausted: poolExhausted() };
}

describe("ai-router drops providers that can never answer", () => {
  it("treats a 401 as fatal for the process — a key does not become valid mid-run", async () => {
    const { cloudRequests, exhausted } = await allCloudProvidersFail(() => ({
      ok: false,
      status: 401,
      text: async () => '{"error":{"code":"invalid_api_key"}}',
    }));

    expect(exhausted).toBe(true);
    // One probe per provider and no more. Before 401 was a hard failure this
    // was one per provider per call — the shape of `sambanova 0/17`.
    expect(cloudRequests).toBe(CLOUD_HOSTS.length);
  });

  it("treats a 200 with a non-JSON body as fatal for the process", async () => {
    const { cloudRequests, exhausted } = await allCloudProvidersFail(() => ({
      ok: true,
      status: 200,
      text: async () => "OK ", // exactly what GitHub Models began returning
      json: async () => { throw new SyntaxError("Unexpected token 'O'"); },
    }));

    expect(exhausted).toBe(true);
    expect(cloudRequests).toBe(CLOUD_HOSTS.length);
  });

  it("does NOT treat a 429 as fatal — throttling is temporary and must recover", async () => {
    const { exhausted } = await allCloudProvidersFail(() => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));

    // The guard on the two tests above: if any failure marked a provider dead,
    // they would pass for the wrong reason. A throttled provider is cooled and
    // demoted, never excluded, so the pool is NOT exhausted.
    expect(exhausted).toBe(false);
  });
});
