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
import { pickGeminiKey, markGeminiKeyCooldown, markGeminiKeyDead, liveGeminiKeyCount, geminiKeyCount } from "./gemini-keys.mjs";
import {
  estimateTokens, fitsProvider, tierModel, laneOf, extraProviders, hedge, cacheKey,
  loadProviderHealth, saveProviderHealth, readCache, writeCache,
} from "./ai-router-support.mjs";
export { chunkText } from "./ai-router-support.mjs";

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
//   AI_GATEWAY_API_KEY  — Vercel AI Gateway ($5 free credits / 30 days, no card;
//                         never bills unless credits are bought). LAST in the chain
//                         so the monthly credit is a reserve, not the default.
// GitHub Actions FORBIDS secret names starting with GITHUB_, so the CI secret
// must be named GH_MODELS_TOKEN; locally GITHUB_MODELS_TOKEN works too. Accept either.
const GITHUB_MODELS_TOKEN = process.env.GITHUB_MODELS_TOKEN || process.env.GH_MODELS_TOKEN;
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
// Free OpenAI-compatible hosts added by env alone: AI_EXTRA_<n>_URL/_KEY/_MODEL/_NAME.
const EXTRAS = extraProviders();

/**
 * Where this process runs, for shared provider health (mig 0297). GitHub
 * Actions, the website and the owner's box hold DIFFERENT keys, so a 401 on one
 * must never park the provider for the others. AI_ROUTER_SCOPE overrides.
 */
const SCOPE = process.env.AI_ROUTER_SCOPE
  || (process.env.GITHUB_ACTIONS ? "gha" : process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY ? "site" : "local");

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

/**
 * Process-wide ceiling on time spent waiting for a throttled pool.
 *
 * Waiting out a 60s throttle turns "0 digested" into a full batch, but a job
 * with --limit 300 could in principle wait on wave after wave and blow its CI
 * timeout — and a cancelled job writes no telemetry at all, which is the 2-day
 * outage class this repo has already been bitten by. So the waiting is budgeted
 * for the whole process, not just per call: generous enough to ride out the
 * throttles that actually occur, hard-capped so it can never become the reason
 * a job is killed.
 */
const TOTAL_WAIT_BUDGET_MS = Number(process.env.AI_ROUTER_WAIT_BUDGET_MS ?? 300_000);
let _waitedMs = 0;

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
  if (AI_GATEWAY_API_KEY) out.push("vercel");
  for (const x of EXTRAS) out.push(x.name);
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
function startCooldown(p, ms = 60_000, reason = "throttled") {
  const until = Date.now() + ms;
  cooldownUntil.set(p, until);
  // Shared (mig 0297): the next cron process, or the next website request in
  // this same scope, skips p until then instead of failing on it again.
  void saveProviderHealth(`${p}@${SCOPE}`, until, reason);
}

/** Load the shared provider health once per process. Never throws, never waits long. */
let _healthLoaded = null;
function ensureHealthLoaded() {
  _healthLoaded ??= loadProviderHealth().then((m) => {
    for (const [scoped, { until }] of m) {
      const [p, scope] = String(scoped).split("@");
      if (scope === SCOPE && until > (cooldownUntil.get(p) ?? 0)) cooldownUntil.set(p, until);
    }
  }).catch(() => {});
  return _healthLoaded;
}

// Opt-in response cache: this process first, then the shared table (mig 0297).
const memCache = new Map();
function remember(key, provider, parsed, ttlHours) {
  memCache.set(key, { provider, parsed, until: Date.now() + ttlHours * 3600_000 });
  if (memCache.size > 200) memCache.delete(memCache.keys().next().value);
  void writeCache(key, provider, parsed, ttlHours);
}
async function recall(key) {
  const m = memCache.get(key);
  if (m && m.until > Date.now()) return { provider: m.provider, parsed: m.parsed };
  return readCache(key);
}

/**
 * HARD FAILURES vs THROTTLING (added 2026-09-16).
 *
 * A 429 means "not right now" and a 60s cooldown is the right answer. Some
 * statuses mean "not ever", and retrying those on every call is pure waste:
 *
 *   401 Unauthorized — the key is wrong, revoked, or was rotated without
 *       updating the secret. A key does not become valid part-way through a
 *       process, so one 401 is proof for the rest of it. Added 2026-09-30:
 *       SambaNova had been recorded as "402, out of credit" when it was in fact
 *       answering `401 {"code":"invalid_api_key"}` — "Incorrect API key
 *       provided: 98896d*****c200". Because 401 was not a hard failure, the
 *       router kept it in the chain and a single enrich-news run logged
 *       `sambanova 0/17`: seventeen round-trips to a key that cannot work,
 *       inside a job timeout, while the run reported `ai NONE-ANSWERED`.
 *   402 Payment Required — Cerebras moved off free tier. Every call to it has
 *       returned "Payment required to access this resource" since then.
 *   410 Gone — GitHub Models is mid-retirement ("github_models_retirement_
 *       brownout"). It is not coming back.
 *
 * 403 is deliberately NOT here. Unlike 401 it is ambiguous — it can mean "this
 * key cannot use this model" rather than "this key is bad" — and no provider has
 * been observed returning it, so treating it as permanent would be speculation.
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
 *
 * 404 counts too, but only for a provider's OWN default model (no per-call
 * modelOverride, large tier). Added 2026-10-31: NVIDIA's default answered
 * `404 Function '…' not found for account` on every call, and because 404 was
 * not here the website kept paying for it, then showed that 404 to a member as
 * the reason Personalize failed. A 404 on a model a caller chose only says
 * that model is wrong for that host, so it stays an ordinary failure.
 */
const HARD_FAIL_STATUS = new Set([401, 402, 410]);

/**
 * Providers that CANNOT answer for the rest of this process.
 *
 * A cooldown was not enough, and the telemetry says so plainly. On 2026-09-25 a
 * single enrich-news run logged `github 0/49, ollama 0/49` — 49 attempts each
 * against GitHub Models, which is permanently 410 (retired), and against local
 * Ollama, which no CI runner can ever reach. That is ~98 guaranteed-useless
 * round-trips in one run, each one costing wall-clock inside a job timeout.
 *
 * The cause is the ordering below: in-cooldown providers are DEMOTED to the back
 * of the chain, not removed from it. That is right for a 429 (it may recover in
 * 60s, and trying it beats failing the call). It is wrong for "gone" — when the
 * whole pool is throttled, every call still walks all the way to the back and
 * pays the dead ones again.
 *
 * So hard failures now go in here and are excluded from the chain entirely for
 * the life of the process. Still NOT removed from availableProviders(): the next
 * process re-probes them, so a provider that comes back is picked up with no
 * deploy. Dead stays cheap, not permanent.
 */
const deadForProcess = new Map(); // provider -> reason
// The longest park that still means "throttled" rather than "gone" (429 parks
// are 60 s; hard failures park for 6 h).
const THROTTLE_PARK_MS = 2 * 60_000;

function noteHardFailure(p, status, body = "", { defaultModel = false } = {}) {
  if (!HARD_FAIL_STATUS.has(status) && !(status === 404 && defaultModel)) return false;
  startCooldown(p, 6 * 3600_000, `gone ${status}: ${body.slice(0, 80)}`);
  if (!deadForProcess.has(p)) {
    deadForProcess.set(p, `${status}`);
    console.log(`    ⓘ ${p} is gone (${status}) — dropped from this run: ${body.slice(0, 70)}`);
  }
  return true;
}

/**
 * Same treatment for a provider whose HOST is unreachable.
 *
 * Ollama is the case that matters: it lives on the owner's PC at
 * localhost:11434, so in GitHub Actions the connection is refused every single
 * time. One refusal is proof enough for the rest of the process — the box is not
 * going to appear mid-run.
 */
/**
 * Same treatment for a provider that answers 2xx with a body that is not JSON.
 *
 * Added 2026-09-30. GitHub Models stopped returning 410 and began answering
 * HTTP **200** with the literal body `OK ` — so the status checks all passed,
 * `r.json()` threw `Unexpected token 'O', "OK " is not valid JSON`, and because
 * that is an exception rather than a status, nothing classified it. The provider
 * stayed in the chain and was re-tried on every single call, which is the exact
 * waste the 401/402/410 handling exists to prevent.
 *
 * A 2xx whose envelope is not JSON is a broken provider, not a transient: it
 * means the endpoint is no longer speaking the API. Dead for this process only,
 * so the next process re-probes it and a provider that comes back needs no
 * deploy — same contract as every other entry in deadForProcess.
 */
function noteUnusableBody(p, raw) {
  startCooldown(p, 6 * 3600_000, "non-JSON body");
  if (!deadForProcess.has(p)) {
    deadForProcess.set(p, "non-JSON body");
    const s = String(raw ?? "").replace(/\s+/g, " ").slice(0, 60);
    console.log(`    ⓘ ${p} answered 2xx with a non-JSON body — dropped from this run: ${s}`);
  }
  return true;
}

/**
 * Parse a 2xx response body as JSON, or classify the provider as unusable.
 *
 * Every provider caller used to do a bare `await r.json()`, which means SEVEN
 * places where a 2xx non-JSON body escaped as an unclassified SyntaxError. The
 * GitHub Models case proved that is not hypothetical. Fixing only the caller
 * that happened to break would leave the other six waiting to do the same, so
 * the check lives here and every caller goes through it.
 */
async function readJsonOrDie(name, r) {
  const raw = await r.text();
  try {
    return JSON.parse(raw);
  } catch {
    noteUnusableBody(name, raw);
    throw new Error(
      `${name} ${r.status} with non-JSON body: ${String(raw).replace(/\s+/g, " ").slice(0, 120)}`,
    );
  }
}

function noteUnreachable(p, err) {
  const msg = String(err?.message ?? err);
  if (!/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|other side closed/i.test(msg)) return false;
  if (!deadForProcess.has(p)) {
    deadForProcess.set(p, "unreachable");
    console.log(`    ⓘ ${p} unreachable — dropped from this run: ${msg.slice(0, 60)}`);
  }
  return true;
}

/** True when every configured provider has proven it cannot answer. */
export function poolExhausted() {
  return availableProviders().every((p) => deadForProcess.has(p));
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

async function callGroq(sys, user, maxTokens, modelOverride, tier = "large", reasoningEffort = null) {
  // modelOverride lets callers route specific tasks (e.g. self-critique)
  // to a reasoning-capable model like openai/gpt-oss-120b while keeping
  // the default for everything else on Llama-3.3-70B. Groq hosts both at $0.
  // 2026-09-05: Groq RETIRED llama-3.3-70b-versatile — the key now 404s with
  // "does not exist or you do not have access to it". Its catalogue is
  // openai/gpt-oss-{120b,20b} and qwen/qwen3.{6,8}-27b. Overridable so the
  // next retirement is an env change, not a deploy.
  const model = modelOverride || tierModel("groq", tier, process.env.GROQ_MODEL || "openai/gpt-oss-120b");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      // gpt-oss thinks before it answers, and those tokens count against the
      // same 8k-per-minute budget as the reply. A rewrite needs little of it.
      ...(reasoningEffort && /gpt-oss/.test(model) ? { reasoning_effort: reasoningEffort } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    const body = await r.text();
    // Out of the main model's DAILY tokens (the jobs spend gpt-oss-120b's 200k
    // by mid-day): Groq meters each model on its own, so a job's call goes to
    // the overflow model instead of failing. qwen3.8-27b sat unused on
    // 2026-10-31 and answered job-shaped JSON prompts correctly in ~0.4 s. Its
    // cap is 1,000 OUTPUT tokens a minute, so a bigger max_tokens is refused.
    // Never the members' model (tier "member"), which jobs must not touch.
    const overflow = process.env.GROQ_MODEL_OVERFLOW ?? "qwen/qwen3.8-27b";
    if (tier === "large" && !modelOverride && overflow && overflow !== model && /per day/i.test(body)) {
      return callGroq(sys, user, Math.min(maxTokens, 1000), overflow, tier, null);
    }
    startCooldown(laneOf("groq", tier), 60_000);
    // Include body excerpt so we can distinguish per-minute throttling
    // from per-day quota exhaustion — the message differs.
    throw new Error(`Groq 429: ${body.slice(0, 200)}`);
  }
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    noteHardFailure("groq", r.status, body, { defaultModel: !modelOverride && tier === "large" });
    throw new Error(`Groq ${r.status}: ${body}`);
  }
  const data = await readJsonOrDie("groq", r);
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

// Statuses that condemn ONE key (invalid key, no billing/credit on its project,
// model not offered to that project), not Gemini itself.
const GEMINI_KEY_REFUSED = new Set([400, 401, 402, 403, 404]);

async function callGemini(sys, user, maxTokens) {
  let lastErr = null;
  for (let tries = Math.max(1, liveGeminiKeyCount()); tries > 0; tries--) {
    try {
      return await callGeminiOnce(sys, user, maxTokens);
    } catch (e) {
      lastErr = e;
      if (!e.keyRefused || liveGeminiKeyCount() === 0) break;
    }
  }
  throw lastErr ?? new Error("Gemini: no key configured");
}

async function callGeminiOnce(sys, user, maxTokens) {
  const key = pickGeminiKey();
  if (!key) throw new Error("Gemini: no usable key");
  // The alias follows Google's current Flash-Lite model (0.9s vs 22s for full
  // Flash, which spends the token budget thinking). Pinned names get retired
  // ("gemini-2.5-flash is no longer available to new users", 2026-10).
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
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
    if (GEMINI_KEY_REFUSED.has(r.status)) {
      markGeminiKeyDead(key);
      if (liveGeminiKeyCount() > 0) {
        throw Object.assign(new Error(`Gemini ${r.status} on one key — trying the next: ${body.slice(0, 80)}`), { keyRefused: true });
      }
    }
    noteHardFailure("gemini", r.status, body);
    throw new Error(`Gemini ${r.status}: ${body}`);
  }
  const d = await readJsonOrDie("gemini", r);
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
  const data = await readJsonOrDie("cerebras", r);
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

async function callMistral(sys, user, maxTokens, tier = "large") {
  // Mistral free tier — generous, fast inference. Default to Small;
  // override via MISTRAL_MODEL env var (e.g. mistral-medium-latest
  // for higher quality, or pixtral-12b-latest for vision).
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: tierModel("mistral", tier, process.env.MISTRAL_MODEL || "mistral-small-latest"),
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
  const data = await readJsonOrDie("mistral", r);
  return parseLooseJson(data.choices?.[0]?.message?.content ?? "{}");
}

async function callCloudflare(sys, user, maxTokens) {
  // Cloudflare Workers AI — 10k neurons/day free, and neurons track each
  // model's price. The old default (Llama 3.3 70B fp8-fast, $0.293/M input)
  // used up the whole day's allocation within about an hour of the 00:00 UTC
  // reset (2026-10-09: "used up your daily free allocation"), so the provider
  // was effectively dead. Gemma 4 26B-A4B is $0.10/M, ~3x the calls, a
  // non-thinking instruct model (no <think> tags to break JSON parsing).
  // Override via CLOUDFLARE_AI_MODEL.
  const model = process.env.CLOUDFLARE_AI_MODEL || "@cf/google/gemma-4-26b-a4b-it";
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
  const data = await readJsonOrDie("cloudflare", r);
  // Cloudflare wraps the OpenAI-compatible response in a result envelope:
  //   { result: { response: "...json..." }, success: true, errors: [] }
  // OR for some models:
  //   { result: { choices: [{ message: { content } }] } }
  const result = data?.result;
  let text;
  if (typeof result?.response === "string") {
    text = result.response;
  } else if (result?.response && typeof result.response === "object") {
    return result.response;
  } else if (result?.choices?.[0]?.message?.content) {
    text = result.choices[0].message.content;
  } else {
    // Gemma 4 thinks first (message.reasoning_content). On a long prompt the
    // thinking can use the whole max_tokens and content comes back empty.
    // This used to stringify the envelope and return IT as the answer, so
    // callers got {id, object, choices...} instead of their JSON (12 BoP
    // findings stamped with empty verdicts, 2026-10-25). Fail, so the router
    // moves on to the next provider.
    const finish = result?.choices?.[0]?.finish_reason ?? "none";
    throw new Error(`Cloudflare returned no content (finish_reason=${finish})`);
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
    // Keyless hosts (AI_EXTRA_<n>_KEY blank) get no Authorization header at all.
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json", ...extraHeaders },
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
    noteHardFailure(name, r.status, body, { defaultModel: !modelOverride });
    throw new Error(`${name} ${r.status}: ${body}`);
  }
  const data = await readJsonOrDie(name, r);
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
  // meta/llama-3.3-70b-instruct reached end of life 2026-08 (410).
    model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b",
}, sys, user, maxTokens, modelOverride);

// Vercel AI Gateway: one OpenAI-compatible endpoint in front of many vendors.
// Paid per token from a free $5/30-day credit; when it runs out the gateway
// refuses (402) and the dead-provider rule drops it for the run. Pick a cheap
// model so the credit lasts; VERCEL_AI_MODEL overrides.
const callVercel = (sys, user, maxTokens, modelOverride) => callOpenAICompat("vercel", {
  url: "https://ai-gateway.vercel.sh/v1/chat/completions",
  key: AI_GATEWAY_API_KEY,
  model: process.env.VERCEL_AI_MODEL || "openai/gpt-oss-120b",
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
  const data = await readJsonOrDie("ollama", r);
  return parseLooseJson(data.message?.content ?? "{}");
}

/**
 * Call exactly ONE provider, with no fallback.
 *
 * Exported for scripts/test-ai-providers.mjs. The smoke test has to be able to
 * ask "does THIS provider answer?", and aiRouter() cannot tell it: a
 * providerOverride only picks where the chain STARTS, so a dead provider
 * silently falls through to a live one and reports success for the wrong
 * provider. Nothing else should use this — production callers want the
 * fallback.
 */
export async function callOneProvider(p, sys, user, maxTokens = 256, modelOverride = null) {
  return callOne(p, sys, user, maxTokens, modelOverride);
}

async function callOne(p, sys, user, maxTokens, modelOverride, tier = "large", reasoningEffort = null) {
  const extra = EXTRAS.find((x) => x.name === p);
  if (extra) {
    return callOpenAICompat(p, { url: extra.url, key: extra.key, model: extra.model }, sys, user, maxTokens, modelOverride);
  }
  switch (p) {
    case "groq": return callGroq(sys, user, maxTokens, modelOverride, tier, reasoningEffort);
    case "gemini": return callGemini(sys, user, maxTokens);
    case "cerebras": return callCerebras(sys, user, maxTokens);
    case "mistral": return callMistral(sys, user, maxTokens, tier);
    case "cloudflare": return callCloudflare(sys, user, maxTokens);
    case "github": return callGithub(sys, user, maxTokens, modelOverride);
    case "sambanova": return callSambanova(sys, user, maxTokens, modelOverride);
    case "openrouter": return callOpenrouter(sys, user, maxTokens, modelOverride);
    case "nvidia": return callNvidia(sys, user, maxTokens, modelOverride);
    case "vercel": return callVercel(sys, user, maxTokens, modelOverride);
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
  // Per-call model override, honored by Groq and the OpenAI-compatible hosts.
  modelOverride = null,
  // How long a call may wait for a fully-parked pool to free up. 0 disables the
  // wait. AI_ROUTER_MAX_WAIT_MS tunes it per workflow without a deploy.
  maxWaitMs = Number(process.env.AI_ROUTER_MAX_WAIT_MS ?? 75_000),
  verbose = true,
  // "small" = a faster sibling model for sorting/classifying (Groq gpt-oss-20b,
  // or <PROVIDER>_MODEL_SMALL). "large" (default) keeps today's models.
  // AI_TIER_DEFAULT lets one workflow trial the small tier without a code change.
  tier = process.env.AI_TIER_DEFAULT || "large",
  // Member-facing calls: if the first provider hasn't answered after hedgeMs,
  // ask the next one too and take whichever answers first. 0 = off.
  hedgeMs = 0,
  // Opt-in cache for prompts that repeat. 0 = off.
  cacheTtlHours = 0,
  // "low" | "medium" | "high" for reasoning models that take it (Groq gpt-oss).
  // null = the host's default. Other providers ignore it.
  reasoningEffort = /** @type {"low" | "medium" | "high" | null} */ (null),
}) {
  await ensureHealthLoaded();
  const key = cacheTtlHours > 0 ? cacheKey({ systemPrompt, userPrompt, maxTokens, tier }) : null;
  if (key) {
    const hit = await recall(key);
    if (hit) return { ...hit, elapsedMs: 0, cached: true };
  }

  const list = availableProviders();
  // Each provider's park on THIS tier's lane (see laneOf). A member lane still
  // honors a hard-failure park on the provider itself: a dead key is dead for both.
  const parkedUntil = (p) => Math.max(
    cooldownUntil.get(laneOf(p, tier)) ?? 0,
    laneOf(p, tier) !== p && (cooldownUntil.get(p) ?? 0) - Date.now() > THROTTLE_PARK_MS ? cooldownUntil.get(p) : 0,
  );
  const cooling = (p) => parkedUntil(p) > Date.now();
  // A member's call starts on the lane kept for members when it is free.
  const start = !providerOverride && tier === "member" && list.includes("groq") && !cooling("groq")
    ? "groq" : pickStart(providerOverride);
  // Cooldown-aware order: try start first, then everyone else, but
  // demote in-cooldown providers to the back.
  // Providers proven gone/unreachable this process are excluded OUTRIGHT, not
  // demoted — see deadForProcess above for the 98-wasted-calls measurement.
  const live = list.filter((p) => !deadForProcess.has(p));
  const chain = live.length ? live : list;   // all dead? try anyway rather than fail blind
  const s = chain.includes(start) ? start : chain[0];
  const fresh = [s, ...chain.filter((p) => p !== s && !cooling(p))];
  const cold = chain.filter((p) => p !== s && cooling(p));
  const order = [...fresh, ...cold];

  const t0 = Date.now();
  const promptTokens = estimateTokens(systemPrompt, userPrompt);
  let lastErr = null;
  let sizeSkipped = 0;
  const finish = ({ provider, parsed }) => {
    if (key) remember(key, provider, parsed, cacheTtlHours);
    return { provider, parsed, elapsedMs: Date.now() - t0 };
  };
  const attempt = async (p) => {
    const h = noteAttempt(p);
    try {
      const parsed = await callOne(p, systemPrompt, userPrompt, maxTokens, modelOverride, tier, reasoningEffort);
      h.ok++;
      return { provider: p, parsed };
    } catch (e) {
      h.fail++;
      h.lastError = String(e?.message ?? e).slice(0, 160);
      // A refused connection is proof for the whole process, not just this call.
      const gone = noteUnreachable(p, e);
      if (verbose) console.log(`    ⚠ ${p} failed: ${h.lastError.slice(0, 140)}`);
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { gone });
    }
  };
  // Usable right now for THIS prompt: not cooling, and the prompt fits its budget.
  const usable = (p) => !cooling(p) && fitsProvider(p, promptTokens, maxTokens);

  const tried = new Set();
  for (const p of order) {
    // Re-check the cooldown HERE, not just when `order` was built: parallel
    // callers (generate-news-digest --concurrency 6) would otherwise all hit the
    // provider the first one just found throttled (the 2026-09-17 stampede).
    if (tried.has(p) || cooling(p)) continue;
    // A prompt bigger than a provider's per-request budget is a guaranteed 413
    // (Groq's 8k TPM cap): route around it instead of paying the round-trip.
    if (!fitsProvider(p, promptTokens, maxTokens)) { sizeSkipped++; continue; }
    tried.add(p);
    const q = hedgeMs > 0 ? order.find((x) => !tried.has(x) && x !== "ollama" && usable(x)) : null;
    try {
      if (!q) return finish(await attempt(p));
      tried.add(q);
      return finish(await hedge(() => attempt(p), () => attempt(q), hedgeMs));
    } catch (e) {
      lastErr = e;
      // The gap lets a throttle breathe; pointless for a provider struck off,
      // and too slow when a member is waiting (hedged calls).
      if (!e?.gone && hedgeMs === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  // A member is waiting (hedged calls only). A 60-second throttle park set by an
  // EARLIER request, theirs or anyone's in this scope, is not proof the provider
  // is still throttled: Groq's per-minute budget refills continuously. Before
  // answering "busy", try the two soonest-to-recover throttled providers once.
  // Hard-failure parks (6 h) are longer than THROTTLE_PARK_MS and stay skipped.
  // Found 2026-10-31: a member's rerolls failed in under a second, every time,
  // because Groq, Mistral, Cloudflare and OpenRouter were all parked.
  if (hedgeMs > 0) {
    const parked = order
      .filter((p) => !tried.has(p) && p !== "ollama" && !deadForProcess.has(p) &&
        parkedUntil(p) - Date.now() <= THROTTLE_PARK_MS &&
        fitsProvider(p, promptTokens, maxTokens))
      .sort((a, b) => parkedUntil(a) - parkedUntil(b))
      .slice(0, 2);
    for (const p of parked) tried.add(p);
    if (parked.length > 0) {
      try {
        const [a, b] = parked;
        return finish(await (b ? hedge(() => attempt(a), () => attempt(b), hedgeMs) : attempt(a)));
      } catch (e) {
        lastErr = e;
      }
    }
  }
  if (tried.size === 0 && sizeSkipped > 0) {
    throw new Error(`PROMPT_TOO_LARGE: ~${promptTokens} tokens + ${maxTokens} reply fits no configured provider; split it with chunkText().`);
  }
  // Distinguish "the pool is empty" from "the pool answered badly". The first is
  // an operator action (add a key); the second is a provider outage to wait out.
  // Both used to surface as the same opaque last-provider error string.
  if (cloudProviderCount() === 0) {
    throw new Error(
      "NO_AI_PROVIDER: no free cloud AI key is configured for this run " +
      "(checked: GROQ_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, " +
      "CEREBRAS_API_KEY, SAMBANOVA_API_KEY, NVIDIA_API_KEY, AI_GATEWAY_API_KEY, CLOUDFLARE_AI_TOKEN, " +
      "GH_MODELS_TOKEN). See docs/AI_PROVIDERS.md.",
    );
  }

  // Throttled, not dead: wait it out. Throwing here turned a 60-second throttle
  // into a whole hour of lost enrichment, because the next cron run is an hour
  // away — that is how a 4-item digest job came back "digested 0" in 5.7s.
  //
  // Fires in BOTH shapes of the same situation: providers already parked when
  // this call started (the stampede's later callers), and providers that 429'd
  // during this very call (the first caller of a throttled minute). Only the
  // second is common, and gating on `attempted === 0` missed it entirely.
  if (order.length > 0) {
    const parks = order.map(parkedUntil).filter((t) => t > Date.now());
    if (parks.length === 0) throw lastErr ?? new Error("all providers failed");
    const soonest = Math.min(...parks);
    const waitMs = Math.max(soonest - Date.now(), 0);
    // Only wait when the wait actually ENDS within our budget. A pool parked
    // entirely on 6-hour hard failures (every provider off the free tier) will
    // look identical to a throttled one otherwise, and we would burn the full
    // budget per call learning nothing had changed.
    if (waitMs > 0 && waitMs <= maxWaitMs && _waitedMs + waitMs <= TOTAL_WAIT_BUDGET_MS) {
      _waitedMs += waitMs;
      if (verbose) console.log(`    ⏸ every provider is cooling — waiting ${Math.ceil(waitMs / 1000)}s rather than giving up`);
      await new Promise((r) => setTimeout(r, waitMs + 250));
      return aiRouter({
        systemPrompt, userPrompt, maxTokens, providerOverride, modelOverride, verbose, tier, hedgeMs, cacheTtlHours, reasoningEffort,
        // One wait per call, never a chain of them.
        maxWaitMs: 0,
      });
    }
  }

  throw lastErr ?? new Error("all providers failed");
}

export function listAvailableProviders() {
  return availableProviders();
}
