import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 2026-11-26: a member's details go to Groq and no other AI. /privacy
 * says so; these hold the code to it.
 */

// Lanes that only ever carry public material. Add one ONLY for a task that can
// never hold a member's name, story, letter, chat message or transcript.
const PUBLIC_LANES = [
  "bill_summary",
  "bill_callout",
  "news_enrich",
  "officials_lookup",
  "reasoning",
  "self_critique",
  "link_classify",
];

// Server code that puts a member's own words or details in a prompt.
const MEMBER_CALLERS = [
  "src/modules/compose/actions.ts",
  "src/modules/alerts/rebuttal-actions.ts",
  "src/modules/chat/moderate.ts",
  "src/modules/campaigns/screen-content.ts",
];

const read = (file: string) => readFileSync(file, "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const sources = walk("src").map((f) => f.split("\\").join("/"));

describe("member details and the site's AI calls", () => {
  it("only public lanes list Gemini", () => {
    const block = read("src/lib/ai/router.ts").match(/const TASK_DEFAULTS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
    const withGemini = [...block.matchAll(/^\s*([a-z_]+): \[([^\]]*)\]/gm)]
      .filter((m) => m[2].includes("gemini"))
      .map((m) => m[1]);
    expect(withGemini.length).toBeGreaterThan(0);
    expect(withGemini.filter((lane) => !PUBLIC_LANES.includes(lane))).toEqual([]);
  });

  it("member-data callers stay off public lanes and off grounding", () => {
    for (const file of MEMBER_CALLERS) {
      const code = read(file);
      const lanes = [...code.matchAll(/complete(?:Structured)?(?:<[\s\S]*?>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
      expect(lanes.length, file).toBeGreaterThan(0);
      expect(lanes.filter((lane) => PUBLIC_LANES.includes(lane)), file).toEqual([]);
      expect(code, file).not.toMatch(/needsGrounding|forceProvider/);
    }
  });

  it("only the router's own provider talks to Google", () => {
    const direct = sources.filter((f) => read(f).includes("generativelanguage.googleapis"));
    expect(direct).toEqual(["src/lib/ai/providers/gemini.ts"]);
  });

  it("every site call to the pooled router is restricted to Groq", () => {
    const users = sources.filter((f) => /(import\(|from )\s*["'][^"']*lib\/ai-router\.mjs["']/.test(read(f)));
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) {
      // Comments off first: one quoting the restriction must not count as it.
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
      const calls = [...code.matchAll(/aiRouter\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
      expect(calls.length, file).toBeGreaterThan(0);
      for (const args of calls) expect(args, file).toContain('only: ["groq"]');
    }
  });
});

describe("with Groq failing and every other key present", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  function setUp(groqKey: string) {
    vi.resetModules();
    const env = {
      GROQ_API_KEY: groqKey,
      GEMINI_API_KEY: "test-gemini",
      MISTRAL_API_KEY: "test-mistral",
      OPENROUTER_API_KEY: "test-openrouter",
      NVIDIA_API_KEY: "test-nvidia",
      CLOUDFLARE_AI_TOKEN: "test-cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      AI_PROVIDER_ORDER: "",
      AI_ROUTER_MAX_WAIT_MS: "0",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const hosts: string[] = [];
    globalThis.fetch = (async (url: string) => {
      const host = new URL(String(url)).hostname;
      if (host === "localhost" || host === "127.0.0.1") throw new Error("ECONNREFUSED");
      hosts.push(host);
      return { ok: false, status: 429, text: async () => "busy", json: async () => ({}) };
    }) as unknown as typeof fetch;
    return hosts;
  }

  it.each(["general", "chat_moderate", "email_stance_screen"] as const)("%s asks nobody else", async (lane) => {
    const hosts = setUp("test-groq");
    const { complete } = await import("@/lib/ai/router");
    await expect(complete(lane, "hello", { preferSpeed: true })).rejects.toThrow();
    expect(hosts.length).toBeGreaterThan(0);
    expect([...new Set(hosts)]).toEqual(["api.groq.com"]);
  });

  // The router's JSDoc types its optional fields from their defaults (null).
  type LooseRouter = (o: object) => Promise<unknown>;
  const ask = { systemPrompt: "s", userPrompt: "u", maxTokens: 50, verbose: false, tier: "member", hedgeMs: 1 };

  it("the pooled router with only: groq asks nobody else", async () => {
    const hosts = setUp("test-groq");
    const { aiRouter } = await import("../scripts/lib/ai-router.mjs");
    const call = aiRouter as unknown as LooseRouter;
    // Twice: the second finds Groq parked, the path that once reached for others.
    await expect(call({ ...ask, only: ["groq"] })).rejects.toThrow();
    await expect(call({ ...ask, only: ["groq"] })).rejects.toThrow();
    expect(hosts.length).toBeGreaterThan(0);
    expect([...new Set(hosts)]).toEqual(["api.groq.com"]);
  });

  it("fails closed when Groq has no key", async () => {
    const hosts = setUp("");
    const { aiRouter } = await import("../scripts/lib/ai-router.mjs");
    const call = aiRouter as unknown as LooseRouter;
    await expect(call({ ...ask, only: ["groq"] })).rejects.toThrow("NO_AI_PROVIDER");
    expect(hosts).toEqual([]);
  });
});
