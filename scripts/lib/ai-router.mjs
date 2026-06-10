/**
 * Shared multi-provider AI router for batch scripts.
 *
 * Round-robin across configured free cloud providers (Groq, Gemini,
 * Cerebras, Mistral, Cloudflare Workers AI, GitHub Models, SambaNova,
 * OpenRouter, NVIDIA NIM — whichever have keys set) with graceful
 * fallback to local Ollama when all cloud providers fail. Each provider
 * is env-gated: no key → silently skipped, so adding one is just a key.
 *
 * Hardened compared to the per-script versions:
 *   - JSON repair on truncated responses (Gemini occasionally emits
 *     "Unterminated string" mid-output; we attempt a salvage pass
 *     before falling through to the next provider).
 *   - Per-provider rate-limit budget tracking. When Groq returns 429
 *     we mark it as cooling-down for 60 seconds and skip it on the
 *     next call within the rotation, instead of pretending it's still
 *     available and failing again.
 *   - Cerebras is now a first-class member of the rotation, not a
 *     conditional add-on.
 *
 * Usage:
 *   import { aiRouter } from "./lib/ai-router.mjs";
 *   const result = await aiRouter({
 *     systemPrompt, userPrompt,
 *     maxTokens: 2048,
 *     providerOverride: "groq",   // optional, force one
 *   });
 *   // → { provider, parsed, usage, elapsedMs }
 */

import { OLLAMA_NUM_THREAD } from "./ollama-options.mjs";

const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
// Extra free-tier providers — all OpenAI-compatible. Activate by adding
// the key to .env.local + the matching GitHub Actions secret. Free keys:
//   GITHUB_MODELS_TOKEN — a GitHub PAT (github.com/settings/tokens, no scopes
//                         needed for Models); free low-volume tier.
//   SAMBANOVA_API_KEY   — cloud.sambanova.ai (free tier, very fast Llama 3.3).
//   OPENROUTER_API_KEY  — openrouter.ai (use ":free" models; US-hosted only).
//   NVIDIA_API_KEY      — build.nvidia.com (free credits; Llama/Nemotron).
const GITHUB_MODELS_TOKEN = process.env.GITHUB_MODELS_TOKEN;
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// Cooldown tracking. When a provider returns 429 we set a deadline
// and skip it until the deadline passes.
const cooldownUntil = new Map();

let _cursor = 0;
function availableProviders() {
  const out = [];
  if (GROQ_KEY) out.push("groq");
  if (GEMINI_KEY) out.push("gemini");
  if (CEREBRAS_KEY) out.push("cerebras");
  if (MISTRAL_KEY) out.push("mistral");
  if (CLOUDFLARE_AI_TOKEN && CLOUDFLARE_ACCOUNT_ID) out.push("cloudflare");
  if (GITHUB_MODELS_TOKEN) out.push("github");
  if (SAMBANOVA_API_KEY) out.push("sambanova");
  if (OPENROUTER_API_KEY) out.push("openrouter");
  if (NVIDIA_API_KEY) out.push("nvidia");
  out.push("ollama");
  return out;
}

function pickStart(override) {
  if (override) return override;
  const cloud = availableProviders().filter((p) => p !== "ollama");
  if (cloud.length === 0) return "ollama";
  // Skip providers in cooldown when picking the next start
  const fresh = cloud.filter((p) => !inCooldown(p));
  if (fresh.length === 0) return cloud[_cursor++ % cloud.length]; // all cooling — try anyway
  return fresh[_cursor++ % fresh.length];
}

function inCooldown(p) {
  const t = cooldownUntil.get(p);
  return t && Date.now() < t;
}
function startCooldown(p, ms = 60_000) {
  cooldownUntil.set(p, Date.now() + ms);
}

/**
 * Strip chain-of-thought reasoning blocks from LLM output.
 * Some reasoning models (originally DeepSeek R1; now GPT-OSS / Qwen)
 * occasionally leak <think>...</think> reasoning even under
 * response_format=json_object. Safe no-op for non-reasoning output.
 */
export function stripReasoningBlocks(text) {
  if (!text) return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>\s*/i, "") // unmatched opening, only closing
    .trim();
}

/**
 * Try to parse JSON output from an LLM, with progressive recovery
 * for the most common truncation pattern (Gemini's "responseMimeType:
 * application/json" sometimes cuts off mid-string).
 */
function parseLooseJson(text) {
  if (!text) throw new Error("empty response");
  // Strip code fences + R1 reasoning blocks if present
  let t = stripReasoningBlocks(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // First attempt: as-is
  try { return JSON.parse(t); } catch {}
  // Repair pass 1: truncated string at the end → close the string + closing braces
  if (t.lastIndexOf('"') !== -1) {
    // count unmatched quotes
    let inStr = false, esc = false, depthObj = 0, depthArr = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depthObj++;
      else if (c === "}") depthObj--;
      else if (c === "[") depthArr++;
      else if (c === "]") depthArr--;
    }
    let repaired = t;
    if (inStr) repaired += '"';
    while (depthArr > 0) { repaired += "]"; depthArr--; }
    while (depthObj > 0) { repaired += "}"; depthObj--; }
    try { return JSON.parse(repaired); } catch {}
    // One more shot: drop trailing comma if present before close braces
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(repaired); } catch {}
  }
  throw new Error(`JSON parse failed; head: ${t.slice(0, 120)}…`);
}

async function callGroq(sys, user, maxTokens, modelOverride) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // modelOverride lets callers route specific tasks (e.g. self-critique)
      // to a reasoning-capable model like openai/gpt-oss-120b while keeping
      // the default for everything else on Llama-3.3-70B. Groq hosts both at $0.
      model: modelOverride || "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    const body = await r.text();
    startCooldown("groq", 60_000);
    // Include body excerpt so we can distinguish per-minute throttling
    // from per-day quota exhaustion — the message differs.
    throw new Error(`Groq 429: ${body.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

async function callGemini(sys, user, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429 || r.status === 503) {
    startCooldown("gemini", 60_000);
    throw new Error(`Gemini ${r.status} (cooling down 60s)`);
  }
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  return parseLooseJson(text);
}

async function callCerebras(sys, user, maxTokens) {
  const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Cerebras retired the old "llama3.1-8b" id (it 404s now, which made
      // this provider a silent no-op fallthrough). Default to their current
      // free Llama 3.3 70B id, served on Cerebras silicon at thousands of
      // tok/sec — fast enough as a classification fallback when Groq + Gemini
      // are in cooldown. Override with CEREBRAS_MODEL if your account exposes
      // a different/bigger model id.
      model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    startCooldown("cerebras", 60_000);
    throw new Error("Cerebras 429 (cooling down 60s)");
  }
  if (!r.ok) throw new Error(`Cerebras ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

async function callMistral(sys, user, maxTokens) {
  // Mistral free tier — generous, fast inference. Default to Small;
  // override via MISTRAL_MODEL env var (e.g. mistral-medium-latest
  // for higher quality, or pixtral-12b-latest for vision).
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL || "mistral-small-latest",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    startCooldown("mistral", 60_000);
    throw new Error("Mistral 429 (cooling down 60s)");
  }
  if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

async function callCloudflare(sys, user, maxTokens) {
  // Cloudflare Workers AI — 10k neurons/day free. Hosts Llama 3.3 70b
  // with fp8 quantization for speed. Endpoint shape is OpenAI-compatible
  // for chat completions but URL path is custom. Override model via
  // CLOUDFLARE_AI_MODEL env var.
  const model = process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${CLOUDFLARE_AI_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      max_tokens: maxTokens,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    startCooldown("cloudflare", 60_000);
    throw new Error("Cloudflare 429 (cooling down 60s)");
  }
  if (!r.ok) throw new Error(`Cloudflare ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  // Cloudflare wraps the OpenAI-compatible response in a result envelope:
  //   { result: { response: "...json..." }, success: true, errors: [] }
  // OR for some models:
  //   { result: { choices: [{ message: { content } }] } }
  const result = data?.result;
  let text;
  if (typeof result?.response === "string") {
    text = result.response;
  } else if (result?.choices?.[0]?.message?.content) {
    text = result.choices[0].message.content;
  } else {
    text = JSON.stringify(result ?? {});
  }
  return parseLooseJson(text || "{}");
}

// Shared OpenAI-compatible chat-completions caller for the extra free
// providers (GitHub Models, SambaNova, OpenRouter, NVIDIA NIM). They all
// speak the same /chat/completions shape; only base URL, auth, default
// model, and any extra headers differ.
async function callOpenAICompat(name, { url, key, model, extraHeaders = {} }, sys, user, maxTokens, modelOverride) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({
      model: modelOverride || model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    startCooldown(name, 60_000);
    throw new Error(`${name} 429 (cooling down 60s)`);
  }
  if (!r.ok) throw new Error(`${name} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

const callGithub = (sys, user, maxTokens, modelOverride) => callOpenAICompat("github", {
  url: "https://models.github.ai/inference/chat/completions",
  key: GITHUB_MODELS_TOKEN,
  model: process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini",
}, sys, user, maxTokens, modelOverride);

const callSambanova = (sys, user, maxTokens, modelOverride) => callOpenAICompat("sambanova", {
  url: "https://api.sambanova.ai/v1/chat/completions",
  key: SAMBANOVA_API_KEY,
  model: process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct",
}, sys, user, maxTokens, modelOverride);

const callOpenrouter = (sys, user, maxTokens, modelOverride) => callOpenAICompat("openrouter", {
  url: "https://openrouter.ai/api/v1/chat/completions",
  key: OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
  extraHeaders: { "HTTP-Referer": "https://www.ikratom.org", "X-Title": "iKratom" },
}, sys, user, maxTokens, modelOverride);

const callNvidia = (sys, user, maxTokens, modelOverride) => callOpenAICompat("nvidia", {
  url: "https://integrate.api.nvidia.com/v1/chat/completions",
  key: NVIDIA_API_KEY,
  model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
}, sys, user, maxTokens, modelOverride);

async function callOllama(sys, user) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // llama3.3:70b no longer fits in RAM beside Docker on the owner box —
      // OLLAMA_ROUTER_MODEL lets the box pin a fitting model (hermes3:8b) so
      // extraction stays local instead of falling through to free-tier quota.
      model: process.env.OLLAMA_ROUTER_MODEL || "llama3.3:70b",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      format: "json",
      stream: false,
      options: { temperature: 0.1, num_thread: OLLAMA_NUM_THREAD },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseLooseJson(data.message?.content ?? "{}");
}

async function callOne(p, sys, user, maxTokens, modelOverride) {
  switch (p) {
    case "groq": return callGroq(sys, user, maxTokens, modelOverride);
    case "gemini": return callGemini(sys, user, maxTokens);
    case "cerebras": return callCerebras(sys, user, maxTokens);
    case "mistral": return callMistral(sys, user, maxTokens);
    case "cloudflare": return callCloudflare(sys, user, maxTokens);
    case "github": return callGithub(sys, user, maxTokens, modelOverride);
    case "sambanova": return callSambanova(sys, user, maxTokens, modelOverride);
    case "openrouter": return callOpenrouter(sys, user, maxTokens, modelOverride);
    case "nvidia": return callNvidia(sys, user, maxTokens, modelOverride);
    case "ollama": return callOllama(sys, user);
    default: throw new Error(`Unknown provider: ${p}`);
  }
}

/**
 * Main entry point. Tries providers in cooldown-aware order until
 * one succeeds. Returns the parsed JSON + which provider produced
 * it + elapsed time.
 */
export async function aiRouter({
  systemPrompt,
  userPrompt,
  maxTokens = 2048,
  providerOverride = null,
  // Per-call model override. Today only honored by Groq — used so the
  // self-critique loop can target DeepSeek R1 Distill 70B while normal
  // generation stays on Llama-3.3-70B. Other providers ignore the value.
  modelOverride = null,
  verbose = true,
}) {
  const list = availableProviders();
  const start = pickStart(providerOverride);
  // Cooldown-aware order: try start first, then everyone else, but
  // demote in-cooldown providers to the back.
  const fresh = [start, ...list.filter((p) => p !== start && !inCooldown(p))];
  const cold = list.filter((p) => p !== start && inCooldown(p));
  const order = [...fresh, ...cold];

  const t0 = Date.now();
  let lastErr = null;
  for (const p of order) {
    try {
      const parsed = await callOne(p, systemPrompt, userPrompt, maxTokens, modelOverride);
      return { provider: p, parsed, elapsedMs: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      if (verbose) {
        const msg = String(e.message ?? e).slice(0, 140);
        // eslint-disable-next-line no-console
        console.log(`    ⚠ ${p} failed: ${msg}`);
      }
      // Brief gap before next provider
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr ?? new Error("all providers failed");
}

export function listAvailableProviders() {
  return availableProviders();
}
