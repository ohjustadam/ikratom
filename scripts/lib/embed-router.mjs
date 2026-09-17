/**
 * Shared multi-provider EMBEDDING router — the vector twin of ai-router.mjs.
 *
 * WHY THIS EXISTS
 * compute-bill-embeddings.mjs and dedupe-news.mjs both call a LOCAL Ollama for
 * nomic-embed-text. That is the last compute dependency on the owner's box
 * (`bill_embeddings` is still `system: "local-box"` in cron-pager-registry.mjs),
 * and it is the reason cross-state bill similarity goes stale whenever the box
 * is off. Every provider below is already a configured repo secret and free
 * tier, so moving the job to CI costs nothing new.
 *
 * THE ONE RULE THAT MATTERS: vectors from different models live in different
 * vector spaces. A bge-base vector and a nomic vector are both 768 floats and
 * cosineSim() will happily compare them and return a confident, meaningless
 * number. So the corpus must be embedded by ONE model at a time, and callers
 * must re-embed everything on a provider switch — never backfill gaps with a
 * different model. `EMBED_DIMS` is checked, but dimension equality is NOT
 * evidence of compatibility; that is why rows carry `embedding_model`.
 *
 * Provider order is deliberate: cloud first (works with the box off), Ollama
 * last (free, unlimited, but only when a machine is actually running it).
 *
 *   import { embed, activeEmbedProvider } from "./lib/embed-router.mjs";
 *   const vec = await embed("some text");   // → number[768]
 */

const DEFAULT_DIMS = 768;

/**
 * The corpus dimensionality. NOT fixed by the schema: `bills.embedding` is a
 * jsonb float array and cosineSim() runs in application JS (no pgvector), so
 * any width works as long as the WHOLE corpus shares it. 768 is simply what
 * nomic-embed-text wrote. Override with EMBED_DIMS to adopt a provider whose
 * native width differs — but only alongside a full re-embed.
 */
const TARGET_DIMS = parseInt(process.env.EMBED_DIMS || String(DEFAULT_DIMS), 10);

const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

/**
 * Registry. `dims` is what the provider returns with the settings below;
 * anything that cannot produce EMBED_DIMS is excluded from the rotation but
 * still probed by scripts/diagnose-cloud-gaps.mjs so the option stays visible.
 *
 * Input limits are real and differ sharply from nomic's 8k context:
 *   bge-base-en-v1.5   512 tokens   (~2000 chars)
 *   text-embedding-004 2048 tokens  (~8000 chars)
 * Callers must cap their text; briefingEmbedText already slices to 8000 chars.
 */
export const EMBED_PROVIDERS = [
  {
    id: "cloudflare",
    model: "@cf/baai/bge-base-en-v1.5",
    dims: 768,
    maxChars: 2000,
    configured: () => Boolean(CLOUDFLARE_AI_TOKEN && CLOUDFLARE_ACCOUNT_ID),
    call: async (text) => {
      const model = process.env.CLOUDFLARE_EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${CLOUDFLARE_AI_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: [text] }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!r.ok) throw new Error(`Cloudflare ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const json = await r.json();
      const vec = json?.result?.data?.[0];
      if (!Array.isArray(vec)) throw new Error(`Cloudflare: no vector in ${JSON.stringify(json).slice(0, 160)}`);
      return vec;
    },
  },
  {
    id: "gemini",
    model: "gemini-embedding-001",
    dims: 768,
    maxChars: 8000,
    configured: () => Boolean(GEMINI_KEY),
    call: async (text) => {
      const model = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            outputDimensionality: TARGET_DIMS,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const json = await r.json();
      const vec = json?.embedding?.values;
      if (!Array.isArray(vec)) throw new Error(`Gemini: no vector in ${JSON.stringify(json).slice(0, 160)}`);
      return vec;
    },
  },
  {
    id: "mistral",
    model: "mistral-embed",
    dims: 1024, // usable, but only via EMBED_DIMS=1024 + a full re-embed
    maxChars: 8000,
    configured: () => Boolean(process.env.MISTRAL_API_KEY),
    call: async (text) => {
      const r = await fetch("https://api.mistral.ai/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "mistral-embed", input: [text] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const json = await r.json();
      const vec = json?.data?.[0]?.embedding;
      if (!Array.isArray(vec)) throw new Error("Mistral: no vector");
      return vec;
    },
  },
  {
    id: "ollama",
    model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
    dims: 768,
    maxChars: 8000,
    configured: () => true, // always "configured"; it just fails fast when absent
    call: async (text) => {
      const { OLLAMA_NUM_THREAD } = await import("./ollama-options.mjs");
      const model = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
      const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text, options: { num_thread: OLLAMA_NUM_THREAD } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const json = await r.json();
      if (!Array.isArray(json.embedding)) throw new Error("Ollama: no vector");
      return json.embedding;
    },
  },
];

const byId = new Map(EMBED_PROVIDERS.map((p) => [p.id, p]));

/** Probe hook — calls exactly one provider, no fallback. Used by the diagnostic. */
export async function embedWith(id, text) {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown embed provider: ${id}`);
  return p.call(text.slice(0, p.maxChars));
}

/**
 * The provider this process will actually use. Honours EMBED_PROVIDER as an
 * explicit override; otherwise takes the first configured 768-dim provider in
 * registry order. Resolved once so a run cannot silently straddle two models
 * (which would poison the corpus — see the rule at the top of this file).
 */
let _active;
export function activeEmbedProvider() {
  if (_active) return _active;
  const forced = process.env.EMBED_PROVIDER;
  if (forced) {
    const p = byId.get(forced);
    if (!p) throw new Error(`EMBED_PROVIDER=${forced} is not a known provider`);
    _active = p;
    return _active;
  }
  const p = EMBED_PROVIDERS.find((x) => x.dims === TARGET_DIMS && x.configured());
  if (!p) throw new Error(`No embedding provider configured at ${TARGET_DIMS} dims`);
  _active = p;
  return _active;
}

/** Embed one string with the active provider. Returns a number[] of EMBED_DIMS. */
export async function embed(text) {
  const p = activeEmbedProvider();
  const vec = await p.call(text.slice(0, p.maxChars));
  if (vec.length !== TARGET_DIMS) {
    throw new Error(`${p.id}/${p.model} returned ${vec.length} dims, expected ${TARGET_DIMS}`);
  }
  return vec;
}

export { TARGET_DIMS as EMBED_DIMS };
