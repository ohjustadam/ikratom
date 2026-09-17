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
import { pickGeminiKey, markGeminiKeyCooldown, geminiKeyCount } from "./gemini-keys.mjs";

const GROQ_KEY = process.env.GROQ_API_KEY;
// Gemini is the one provider with a multi-key pool (one free key per GCP
// project, each with its own quota). gemini-keys.mjs owns that rotation; the
// router asks it for a key per call instead of pinning process.env.GEMINI_API_KEY,
// so adding GEMINI_API_KEY_2..9 multiplies the router's free ceiling too.
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
// GitHub Actions FORBIDS secret names starting with GITHUB_, so the CI secret
// must be named GH_MODELS_TOKEN; locally GITHUB_MODELS_TOKEN works too. Accept either.
const GITHUB_MODELS_TOKEN = process.env.GITHUB_MODELS_TOKEN || process.env.GH_MODELS_TOKEN;
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// Cooldown tracking. When a provider returns 429 we set a deadline
// and skip it until the deadline passes.
const cooldownUntil = new Map();

/**
 * Per-provider health for the life of the process.
 *
 * WHY: until now a run where every provider was dead and a run where the first
 * provider answered every call looked identical in the logs — a wall of
 * "⚠ <provider> failed" lines with no total, and callers reported only their own
 * "N failed". That is how the pool could collapse to one rate-limited provider
 * for days without the telemetry saying so. logProviderSummary() prints one line
 * per provider at the end of a run, and providerSummary() hands the same data to
 * scraper_runs so a depleted pool is a visible fact rather than a guess.
 */
const health = new Map(); // provider -> { attempts, ok, fail, lastError }

function noteAttempt(p) {
  const h = health.get(p) ?? { attempts: 0, ok: 0, fail: 0, lastError: null };
  h.attempts++;
  health.set(p, h);
  return h;
}

/** Snapshot of provider health, sorted most-used first. Safe to JSON.stringify. */
export function providerSummary() {
  return [...health.entries()]
    .map(([provider, h]) => ({ provider, ...h }))
    .sort((a, b) => b.attempts - a.attempts);
}

/**
 * One compact line of provider health, for scraper_runs.notes.
 *
 * The telemetry every cron script writes said "18 failed" and nothing about
 * WHY, so a depleted provider pool and a genuinely broken classifier produced
 * identical rows. Appending this makes the difference queryable after the fact,
 * which is the only way to notice the pool shrinking before a pipeline stops.
 * Example: "ai: openrouter 12/3, mistral 0/5" (ok/fail).
 */
export function providerNote() {
  const rows = providerSummary();
  if (rows.length === 0) return "ai: no calls";
  const parts = rows.map((r) => `${r.provider} ${r.ok}/${r.fail}`);
  const anyOk = rows.some((r) => r.ok > 0);
  return `ai${anyOk ? "" : " NONE-ANSWERED"}: ${parts.join(", ")}`;
}

/**
 * Print the pool's health. Call once at the end of a script that makes many AI
 * calls — the cost is one block of output per run, and it is the difference
 * between "18 failed" and "18 failed because every configured provider is 429".
 */
export function logProviderSummary(label = "AI providers") {
  const rows = providerSummary();
  const configured = availableProviders();
  if (rows.length === 0) {
    console.log(`  ${label}: no calls made (configured: ${configured.join(", ") || "none"})`);
    return;
  }
  console.log(`  ${label} — configured: ${configured.join(", ")}`);
  for (const r of rows) {
    const note = r.ok === 0 && r.fail > 0 ? `  ← never answered: ${String(r.lastError ?? "").slice(0, 70)}` : "";
    console.log(`    ${r.provider.padEnd(11)} ok ${String(r.ok).padStart(4)} / fail ${String(r.fail).padStart(4)}${note}`);
  }
  const anyOk = rows.some((r) => r.ok > 0);
  if (!anyOk) {
    console.log(`  ⚠ NO free AI provider answered this run. Add a key (see docs/AI_PROVIDERS.md) — enrichment is blocked, not broken.`);
  }
}

let _cursor = 0;

/**
 * AI_PROVIDER_ORDER — comma-separated provider names, highest priority first.
 * Providers named here are tried before any others; anything unnamed keeps its
 * default position behind them. Unknown or unconfigured names are ignored.
 *
 * WHY: when a provider dies (Cerebras → paid, GitHub Models → retired) or a new
 * free one appears, the fix should be an env change on the workflow, not a
 * deploy. `AI_PROVIDER_ORDER=groq,mistral,openrouter` is the whole knob.
 */
function orderPreference() {
  return (process.env.AI_PROVIDER_ORDER || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function applyPreference(list) {
  const pref = orderPreference();
  if (pref.length === 0) return list;
  const preferred = pref.filter((p) => list.includes(p));
  return [...preferred, ...list.filter((p) => !preferred.includes(p))];
}

function availableProviders() {
  const out = [];
  if (GROQ_KEY) out.push("groq");
  if (geminiKeyCount() > 0) out.push("gemini");
  if (CEREBRAS_KEY) out.push("cerebras");
  if (MISTRAL_KEY) out.push("mistral");
  if (CLOUDFLARE_AI_TOKEN && CLOUDFLARE_ACCOUNT_ID) out.push("cloudflare");
  if (GITHUB_MODELS_TOKEN) out.push("github");
  if (SAMBANOVA_API_KEY) out.push("sambanova");
  if (OPENROUTER_API_KEY) out.push("openrouter");
  if (NVIDIA_API_KEY) out.push("nvidia");
  // Ollama stays last by default: it only answers on the owner's box, so in the
  // cloud it is a guaranteed timeout, not a fallback. AI_PROVIDER_ORDER can
  // still promote it for local runs.
  out.push("ollama");
  return applyPreference(out);
}

/**
 * Cloud providers only — what the router can actually reach from CI.
 * Exported so a script can say "no free provider is configured" up front
 * instead of discovering it one failed item at a time.
 */
export function cloudProviderCount() {
  return availableProviders().filter((p) => p !== "ollama").length;
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
 * HARD FAILURES vs THROTTLING (added 2026-09-16).
 *
 * A 429 means "not right now" and a 60s cooldown is the right answer. Some
 * statuses mean "not ever", and retrying those on every call is pure waste:
 *
 *   402 Payment Required — Cerebras moved off free tier. Every call to it has
 *       returned "Payment required to access this resource" since then.
 *   410 Gone — GitHub Models is mid-retirement ("github_models_retirement_
 *       brownout"). It is not coming back.
 *
 * Measured on 2026-09-16: of nine configured providers only openrouter and
 * ollama answered, and every single AI call in every cron script was still
 * paying a full round-trip to both of these before reaching one that works.
 * Cooldowns live in a Map for the life of the process, and cron scripts make
 * hundreds of calls per process, so skipping after the first hard failure is
 * most of the win — without needing new state or a deploy when the next
 * provider dies.
 *
 * Deliberately NOT removing them from availableProviders(): if Cerebras
 * reinstates a free tier or GitHub reverses course, the next process picks
 * them straight back up. This makes a dead provider cheap, not permanent.
 */
const HARD_FAIL_STATUS = new Set([402, 410]);
function noteHardFailure(p, status, body = "") {
  if (!HARD_FAIL_STATUS.has(status)) return false;
  // 6h, not forever: long enough that a cron run pays the round-trip once
  // instead of hundreds of times, short enough that recovery is automatic.
  startCooldown(p, 6 * 3600_000);
  console.log(`    ⓘ ${p} hard-failed (${status}) — skipping it for 6h: ${body.slice(0, 80)}`);
  return true;
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
      // 2026-09-05: Groq RETIRED llama-3.3-70b-versatile — the key now 404s with
      // "does not exist or you do not have access to it". Its catalogue is
      // openai/gpt-oss-{120b,20b} and qwen/qwen3.{6,8}-27b. Overridable so the
      // next retirement is an env change, not a deploy.
      model: modelOverride || process.env.GROQ_MODEL || "openai/gpt-oss-120b",
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("groq", r.status, body);
    throw new Error(`Groq ${r.status}: ${body}`);
  }
  const data = await r.json();
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

async function callGemini(sys, user, maxTokens) {
  const key = pickGeminiKey();
  if (!key) throw new Error("Gemini: no key configured");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
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
    // Park THIS key, not the whole provider: with several free keys (one per
    // GCP project) an exhausted key must not take the others down with it.
    markGeminiKeyCooldown(key);
    if (geminiKeyCount() <= 1) startCooldown("gemini", 60_000);
    throw new Error(`Gemini ${r.status} (key parked; ${geminiKeyCount()} key(s) in pool)`);
  }
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("gemini", r.status, body);
    throw new Error(`Gemini ${r.status}: ${body}`);
  }
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  return parseLooseJson(text);
}

async function callCerebras(sys, user, maxTokens) {
  const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Model ids on Cerebras drift; "llama-3.3-70b" 404s on this account
      // (verified 2026-06-16: account exposes only gpt-oss-120b + zai-glm-4.7),
      // which silently made this provider a dead 404 no-op across the whole
      // rotation. Default to gpt-oss-120b — OpenAI open-weights (MIT), US-hosted
      // on Cerebras silicon at thousands of tok/sec, the same model we already
      // trust for reasoning via Groq. Override with CEREBRAS_MODEL.
      // 2026-09-05: Cerebras now answers 402 "Payment required to access this
      // resource" — it has left the free tier. Retained for anyone who adds
      // billing, but it can no longer be counted as a free provider.
      model: process.env.CEREBRAS_MODEL || "gpt-oss-120b",
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("cerebras", r.status, body);
    throw new Error(`Cerebras ${r.status}: ${body}`);
  }
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("mistral", r.status, body);
    throw new Error(`Mistral ${r.status}: ${body}`);
  }
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("cloudflare", r.status, body);
    throw new Error(`Cloudflare ${r.status}: ${body}`);
  }
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure(name, r.status, body);
    throw new Error(`${name} ${r.status}: ${body}`);
  }
  const data = await r.json();
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

const callGithub = (sys, user, maxTokens, modelOverride) => callOpenAICompat("github", {
  url: "https://models.github.ai/inference/chat/completions",
  key: GITHUB_MODELS_TOKEN,
  // 2026-09-05: GitHub Models returns 410 "github_models_retirement_brownout"
  // — the service is being retired. Kept configured so it resumes if the
  // brownout lifts, but it must not be relied on. See availableProviders().
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
  // Individual ":free" slugs churn faster than we can chase them: the llama
  // slug died before 2026-09-05, z-ai/glm-5.2:free was set that day and was
  // itself 404 "unavailable for free" by 09-07. "openrouter/free" is
  // OpenRouter's STABLE meta-slug that routes to whatever is free right now,
  // so it does not rot on a schedule. (To audit the underlying pool:
  // GET /api/v1/models, keep pricing.prompt == "0" — 16 of 428 on 09-07.)
  model: process.env.OPENROUTER_MODEL || "openrouter/free",
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("ollama", r.status, body);
    throw new Error(`Ollama ${r.status}: ${body}`);
  }
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
    const h = noteAttempt(p);
    try {
      const parsed = await callOne(p, systemPrompt, userPrompt, maxTokens, modelOverride);
      h.ok++;
      return { provider: p, parsed, elapsedMs: Date.now() - t0 };
    } catch (e) {
      h.fail++;
      h.lastError = String(e.message ?? e).slice(0, 160);
      lastErr = e;
      if (verbose) {
        console.log(`    ⚠ ${p} failed: ${h.lastError.slice(0, 140)}`);
      }
      // Brief gap before next provider
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  // Distinguish "the pool is empty" from "the pool answered badly". The first is
  // an operator action (add a key); the second is a provider outage to wait out.
  // Both used to surface as the same opaque last-provider error string.
  if (cloudProviderCount() === 0) {
    throw new Error(
      "NO_AI_PROVIDER: no free cloud AI key is configured for this run " +
      "(checked: GROQ_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, " +
      "CEREBRAS_API_KEY, SAMBANOVA_API_KEY, NVIDIA_API_KEY, CLOUDFLARE_AI_TOKEN, " +
      "GH_MODELS_TOKEN). See docs/AI_PROVIDERS.md.",
    );
  }
  throw lastErr ?? new Error("all providers failed");
}

export function listAvailableProviders() {
  return availableProviders();
}
