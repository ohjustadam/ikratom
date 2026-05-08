/**
 * Shared multi-provider AI router for batch scripts.
 *
 * Round-robin across configured cloud providers (Groq → Gemini →
 * Cerebras) with graceful fallback to local Ollama when all cloud
 * providers fail.
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

const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
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
 * Try to parse JSON output from an LLM, with progressive recovery
 * for the most common truncation pattern (Gemini's "responseMimeType:
 * application/json" sometimes cuts off mid-string).
 */
function parseLooseJson(text) {
  if (!text) throw new Error("empty response");
  // Strip code fences if any
  let t = text.trim()
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

async function callGroq(sys, user, maxTokens) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 429) {
    startCooldown("groq", 60_000);
    throw new Error("Groq 429 (cooling down 60s)");
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
      // Cerebras free-tier currently grants access to llama3.1-8b for
      // most accounts (other listed models like gpt-oss-120b require a
      // paid plan). 8B is small but Cerebras's silicon serves it at
      // ~3000 tok/sec — fast enough for classification fallback when
      // Groq + Gemini are in cooldown. Override with CEREBRAS_MODEL
      // env var if your account has access to bigger models.
      model: process.env.CEREBRAS_MODEL || "llama3.1-8b",
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

async function callOllama(sys, user) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.3:70b",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      format: "json",
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parseLooseJson(data.message?.content ?? "{}");
}

async function callOne(p, sys, user, maxTokens) {
  switch (p) {
    case "groq": return callGroq(sys, user, maxTokens);
    case "gemini": return callGemini(sys, user, maxTokens);
    case "cerebras": return callCerebras(sys, user, maxTokens);
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
      const parsed = await callOne(p, systemPrompt, userPrompt, maxTokens);
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
