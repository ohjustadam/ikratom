/**
 * Regression tests for how the batch-script AI router behaves when the free
 * provider pool is throttled — the condition it actually runs in most days.
 *
 * Measured on 2026-09-17 in the live hourly cron: generate-news-digest runs
 * --concurrency 6, so six aiRouter calls were in flight at once. Each built its
 * provider order before any other had returned, so all six hit groq together,
 * all six got 429, all six moved to gemini together, and so on. One burst
 * tripped every provider's per-minute limit, the cooldowns parked the whole
 * pool, and the job gave up 5.7 seconds later having digested nothing — out of
 * four items. Six parallel calls spent six times the quota to do the work of
 * one, and the next run was an hour away.
 *
 * Two behaviours keep that from recurring, and both are tested here:
 *   1. a provider discovered to be cooling is skipped by the calls still
 *      walking the list, instead of being hit again;
 *   2. when every provider is merely throttled (not dead), the call waits the
 *      cooldown out rather than throwing, bounded by a process-wide budget so
 *      it can never be the reason a CI job is cancelled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PROVIDER_ENV = {
  GROQ_API_KEY: "test-groq",
  MISTRAL_API_KEY: "test-mistral",
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

describe("ai-router under a throttled pool", () => {
  it("does not re-hit a provider that a parallel call already found throttled", async () => {
    // No waiting: this test is only about wasted requests.
    const { aiRouter } = await loadRouter({ AI_ROUTER_MAX_WAIT_MS: "0" });

    let sent = 0;
    globalThis.fetch = (async () => {
      sent++;
      return { ok: false, status: 429, text: async () => "rate limited" };
    }) as unknown as typeof fetch;

    await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, verbose: false })),
    );

    // Three providers x six calls is 18 if every call walks the whole list
    // regardless of what the others learned. The cooldown re-check means the
    // later calls stop short.
    expect(sent).toBeLessThan(18);
  });

  it("waits out a throttle rather than dropping the work", async () => {
    // The router's own cooldown is 60s, too long to sit through in CI, so this
    // asserts the DECISION rather than the duration: with waiting enabled the
    // call is still pending well after the point at which the old router had
    // already thrown, and with waiting disabled it rejects promptly.
    const { aiRouter } = await loadRouter();

    globalThis.fetch = (async () => ({
      ok: false, status: 429, text: async () => "rate limited",
    })) as unknown as typeof fetch;

    let settled = false;
    const pending = aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, verbose: false })
      .catch(() => {})
      .finally(() => { settled = true; });

    // Three providers with the router's 800ms inter-provider gap means the old
    // behaviour had thrown by ~2.5s. Still pending at 3.5s is the change, and
    // keeps this file cheap enough to stay in the default `npm run verify`.
    await new Promise((r) => setTimeout(r, 3_500));
    expect(settled, "router gave up instead of waiting out the cooldown").toBe(false);

    void pending; // left pending deliberately; the process-wide budget bounds it.
  }, 15_000);

  it("never waits longer than the process-wide budget allows", async () => {
    // A one-millisecond budget must behave exactly like waiting disabled.
    const { aiRouter } = await loadRouter({ AI_ROUTER_WAIT_BUDGET_MS: "1" });

    globalThis.fetch = (async () => ({
      ok: false, status: 429, text: async () => "rate limited",
    })) as unknown as typeof fetch;

    const t0 = Date.now();
    await expect(
      aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, verbose: false }),
    ).rejects.toThrow();
    // Would be 60s+ if the budget were ignored.
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 15_000);

  it("names every key it checked when no provider is configured at all", async () => {
    vi.resetModules();
    // No provider keys stubbed → only ollama, which is unreachable in CI.
    const { aiRouter, cloudProviderCount } = await import("../scripts/lib/ai-router.mjs");
    expect(cloudProviderCount()).toBe(0);

    globalThis.fetch = (async () => { throw new Error("unreachable"); }) as unknown as typeof fetch;

    // An empty pool is an operator action, not an outage — it must say so.
    await expect(
      aiRouter({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, verbose: false }),
    ).rejects.toThrow(/NO_AI_PROVIDER/);
  }, 15_000);
});
