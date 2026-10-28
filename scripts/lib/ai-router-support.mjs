/**
 * ai-router-support.mjs — the pieces that make the free AI router sturdier
 * (owner, 2026-10-27). Kept apart from ai-router.mjs so each one is testable
 * without a network or a key:
 *
 *  1. Provider health that outlives the process (ai_provider_health, mig 0297).
 *  2. Hedging: when a member is waiting, ask a second provider if the first is slow.
 *  3. An opt-in response cache for repeated prompts (ai_response_cache, mig 0297).
 *  4. Model tiers: a small model for sorting and classifying, a large one for writing.
 *  5. Size-aware routing: never send a prompt to a provider whose per-request
 *     budget it can't fit (Groq's 8k tokens-per-minute cap answers 413).
 *  6. Extra provider slots: any free OpenAI-compatible host, from env alone.
 *
 * Persistence talks to PostgREST with plain fetch (no supabase-js), so the same
 * module works in cron scripts and in the website's server actions. Every
 * persistence call is best-effort with a short timeout: the router must never
 * fail, or wait long, because its memory is unavailable.
 */
import { createHash } from "node:crypto";

// ── 5. Size-aware routing ───────────────────────────────────────────────────

/** Rough token count: ~4 characters per token for English prose and JSON. */
export const estimateTokens = (...texts) => Math.ceil(texts.reduce((n, t) => n + String(t ?? "").length, 0) / 4);

/**
 * The largest request (prompt + reply budget, in tokens) a provider accepts on
 * its free tier. Groq counts both against an 8,000 tokens-per-minute cap and
 * refuses a single bigger request outright (413). Unlisted providers have
 * context windows far beyond anything the router sends.
 */
const REQUEST_BUDGET = { groq: 7_500, cloudflare: 7_000 };
export function fitsProvider(provider, promptTokens, maxTokens, env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const override = Number(env[`AI_BUDGET_${provider.toUpperCase()}`]);
  const budget = Number.isFinite(override) && override > 0 ? override : REQUEST_BUDGET[provider];
  return budget == null || promptTokens + maxTokens <= budget;
}

/**
 * Split long text into pieces of at most `maxTokens` (estimated), on paragraph
 * then sentence boundaries, for callers that process long documents and would
 * otherwise only fit the largest providers.
 */
export function chunkText(text, maxTokens = 3_000) {
  const limit = maxTokens * 4;
  const out = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const para of String(text ?? "").split(/\n{2,}/)) {
    const pieces = para.length > limit ? para.split(/(?<=[.!?])\s+/) : [para];
    for (const p of pieces) {
      if (p.length > limit) { push(); for (let i = 0; i < p.length; i += limit) out.push(p.slice(i, i + limit)); continue; }
      if (cur.length + p.length + 2 > limit) push();
      cur += (cur ? "\n\n" : "") + p;
    }
  }
  push();
  return out;
}

// ── 4. Model tiers ──────────────────────────────────────────────────────────

/**
 * The model a provider should use for a tier. "large" (the default) is the
 * router's existing choice, so callers that never pass a tier are unchanged.
 * "small" picks a faster, cheaper model where the provider offers one known to
 * exist; elsewhere it falls back to the large model. Every choice is
 * env-overridable (`<PROVIDER>_MODEL_SMALL`), so a retired model is an env
 * change, not a deploy.
 */
const SMALL_DEFAULT = { groq: "openai/gpt-oss-20b", mistral: "mistral-small-latest", gemini: "gemini-flash-lite-latest" };
export function tierModel(provider, tier, largeModel, env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  if (tier !== "small") return largeModel;
  return env[`${provider.toUpperCase()}_MODEL_SMALL`] || SMALL_DEFAULT[provider] || largeModel;
}

// ── 6. Extra provider slots ─────────────────────────────────────────────────

/**
 * AI_EXTRA_<n>_URL / _KEY / _MODEL / _NAME, for n = 1..5. A free OpenAI-compatible
 * host joins the pool with three env vars and no code. _KEY may be blank for
 * keyless hosts. _NAME defaults to "extra<n>" and must be a simple slug.
 */
export function extraProviders(env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const out = [];
  for (let n = 1; n <= 5; n++) {
    const url = String(env[`AI_EXTRA_${n}_URL`] ?? "").trim();
    const model = String(env[`AI_EXTRA_${n}_MODEL`] ?? "").trim();
    if (!url || !model) continue;
    const raw = String(env[`AI_EXTRA_${n}_NAME`] ?? "").trim().toLowerCase();
    const name = /^[a-z][a-z0-9-]{1,23}$/.test(raw) ? raw : `extra${n}`;
    const base = url.replace(/\/+$/, "");
    out.push({
      name,
      url: /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`,
      key: String(env[`AI_EXTRA_${n}_KEY`] ?? "").trim() || null,
      model,
    });
  }
  return out;
}

// ── 2. Hedging ──────────────────────────────────────────────────────────────

/**
 * Run `first()`; if it hasn't settled after `delayMs`, also run `second()`, and
 * resolve with whichever SUCCEEDS first. Rejects only when every started call
 * has failed (with the first one's error). `second` is never started when
 * `first` settles before the delay, so quota is spent only when it's slow.
 * The loser is left to finish on its own; its result is ignored.
 */
export function hedge(first, second, delayMs) {
  return new Promise((resolve, reject) => {
    let settled = false, running = 0, secondStarted = false, firstErr, timer;
    const fail = () => {
      if (!settled && running === 0 && (secondStarted || !second)) { settled = true; clearTimeout(timer); reject(firstErr); }
    };
    const run = (fn) => {
      running++;
      Promise.resolve().then(fn).then(
        (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
        (e) => {
          running--;
          firstErr ??= e;
          // A fast failure starts the second call at once: plain fallback.
          if (second && !secondStarted && !settled) startSecond(); else fail();
        },
      );
    };
    const startSecond = () => { if (secondStarted || settled) return; secondStarted = true; clearTimeout(timer); run(second); };
    run(first);
    if (second) timer = setTimeout(startSecond, Math.max(0, delayMs));
  });
}

// ── 3. Cache keys ───────────────────────────────────────────────────────────

export const cacheKey = ({ systemPrompt, userPrompt, maxTokens, tier = "large" }) =>
  createHash("sha256").update(JSON.stringify([tier, maxTokens, systemPrompt, userPrompt])).digest("hex");

// ── 1 + 3. Persistence (best-effort, service role only) ─────────────────────

function rest(env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // Off under vitest unless a test opts in: a unit test must never write to the
  // production database just because .env.local is on the developer's machine.
  if (!url || !key || env.AI_ROUTER_PERSIST === "0" || (env.VITEST && env.AI_ROUTER_PERSIST !== "1")) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
  const call = (path, init = {}) =>
    fetch(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(1_500) });
  return call;
}

/** Provider → cooldown deadline (ms) for every provider still cooling. Empty on any failure. */
export async function loadProviderHealth(env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const call = rest(env);
  if (!call) return new Map();
  try {
    const r = await call(`ai_provider_health?select=provider,cooldown_until,reason&cooldown_until=gt.${encodeURIComponent(new Date().toISOString())}`);
    if (!r.ok) return new Map();
    return new Map((await r.json()).map((row) => [row.provider, { until: Date.parse(row.cooldown_until), reason: row.reason }]));
  } catch { return new Map(); }
}

/** Record that `provider` should be skipped until `untilMs`. Fire-and-forget. */
export function saveProviderHealth(provider, untilMs, reason, env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const call = rest(env);
  if (!call) return Promise.resolve(false);
  return call("ai_provider_health", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ provider, cooldown_until: new Date(untilMs).toISOString(), reason: String(reason ?? "").slice(0, 200), updated_at: new Date().toISOString() }),
  }).then((r) => r.ok, () => false);
}

/** A cached { provider, parsed } for this key, or null. */
export async function readCache(key, env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const call = rest(env);
  if (!call) return null;
  try {
    const r = await call(`ai_response_cache?select=provider,response&key=eq.${key}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`);
    if (!r.ok) return null;
    const [row] = await r.json();
    return row ? { provider: row.provider, parsed: row.response } : null;
  } catch { return null; }
}

/** Store a response for `ttlHours`, and purge a batch of expired rows. Fire-and-forget. */
export function writeCache(key, provider, parsed, ttlHours, env = /** @type {Record<string, string | undefined>} */ (process.env)) {
  const call = rest(env);
  if (!call) return Promise.resolve(false);
  const now = new Date().toISOString();
  return Promise.all([
    call("ai_response_cache", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key, provider, response: parsed, expires_at: new Date(Date.now() + ttlHours * 3600_000).toISOString() }),
    }),
    call(`ai_response_cache?expires_at=lt.${encodeURIComponent(now)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  ]).then(([r]) => r.ok, () => false);
}
