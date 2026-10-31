/**
 * The website's Groq provider (src/lib/ai/providers/groq.ts) runs on the
 * members' model, and a model that is out of its allowance falls back to it.
 *
 * Found 2026-10-31: the site called gpt-oss-120b, whose 200k tokens a day the
 * background jobs spend by mid-day, so letter screening, campaign screening and
 * chat moderation failed every afternoon. Groq meters each model separately.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });

async function loadGroq() {
  vi.resetModules();
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("GROQ_DEFAULT_MODEL", "");
  vi.stubEnv("GROQ_MODEL_MEMBER", "");
  // An empty stub would read as "set", so remove them for this import.
  delete process.env.GROQ_DEFAULT_MODEL;
  delete process.env.GROQ_MODEL_MEMBER;
  return (await import("../src/lib/ai/providers/groq")).groq;
}

function mock(answer: (model: string) => { status: number; body: unknown }) {
  const models: string[] = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const model = JSON.parse(init?.body ?? "{}").model as string;
    models.push(model);
    const a = answer(model);
    return {
      ok: a.status < 400, status: a.status,
      json: async () => a.body, text: async () => JSON.stringify(a.body),
    };
  }) as unknown as typeof fetch;
  return models;
}
const reply = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } });

describe("site Groq provider", () => {
  it("defaults to the members' model", async () => {
    const groq = await loadGroq();
    const models = mock(() => reply('{"ok":true}'));
    const r = await groq.completeStructured<{ ok: boolean }>("x", { type: "object" });
    expect(models).toEqual(["openai/gpt-oss-20b"]);
    expect(r.modelUsed).toBe("openai/gpt-oss-20b");
  });

  it("falls back to the members' model when an override is out of allowance", async () => {
    const groq = await loadGroq();
    const models = mock((m) => (m === "openai/gpt-oss-120b"
      ? { status: 429, body: { error: { message: "tokens per day (TPD)" } } }
      : reply("fine")));
    const r = await groq.complete("x", { model: "openai/gpt-oss-120b" });
    expect(models).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    expect(r.modelUsed).toBe("openai/gpt-oss-20b");
  });

  it("does not loop when the members' model itself is throttled", async () => {
    const groq = await loadGroq();
    const models = mock(() => ({ status: 429, body: { error: { message: "rate" } } }));
    await expect(groq.complete("x")).rejects.toThrow(/Groq 429/);
    expect(models).toEqual(["openai/gpt-oss-20b"]);
  });
});
