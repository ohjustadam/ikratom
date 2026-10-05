#!/usr/bin/env node
/**
 * AI provider smoke test — "which of the free providers actually answers?"
 *
 *   npm run ai:smoke                 # probe every configured provider
 *   node --env-file=.env.local scripts/test-ai-providers.mjs --json
 *
 * Exit code is 0 only if at least one provider answered. Non-zero means the
 * router has nothing to work with, which is the state in which every
 * AI-dependent cron logs `ai NONE-ANSWERED` and reports a hollow success.
 *
 * ---------------------------------------------------------------------------
 * REWRITTEN 2026-09-30, because the previous version could not fail.
 *
 * It printed a hardcoded "✓" on the same line as the output, with the output
 * falling back to the string "(no output)" — so a provider that returned
 * nothing rendered as `✓ plain 198ms (no output)…` and the script still exited
 * 0. Observed that day: ollama reported `✓ plain 7ms undefined…` (a 7 ms LLM
 * call) and gemini and groq both reported `✓` with `(no output)`, while the
 * crons were simultaneously logging `0 enriched · 12 failed · ai
 * NONE-ANSWERED: github 0/17, sambanova 0/17, groq 0/7`. The one tool for
 * answering "what is broken in the router" was saying everything was fine.
 *
 * It also only knew about three providers (ollama, gemini, groq) out of the
 * nine the router uses, so SambaNova's invalid key, GitHub Models' 410 and
 * Cerebras' 402 were invisible to it — and it re-implemented each provider's
 * HTTP shape by hand, so it could agree with itself while disagreeing with the
 * router. The comment justifying that duplication said the router could not be
 * imported "without a build step"; that stopped being true when the router
 * became scripts/lib/ai-router.mjs.
 *
 * Now: it asks the router itself, one provider at a time, and asserts.
 * ---------------------------------------------------------------------------
 */

import { listAvailableProviders, callOneProvider } from "./lib/ai-router.mjs";

const JSON_OUT = process.argv.includes("--json");

/** Every provider the router knows, with the env var that enables it. */
const ENV_FOR = {
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY (or GEMINI_API_KEY_2..9)",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cloudflare: "CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID",
  github: "GH_MODELS_TOKEN",
  sambanova: "SAMBANOVA_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  ollama: "OLLAMA_HOST (owner's box only — never reachable from CI)",
};
const ALL = Object.keys(ENV_FOR);

// The router is JSON-only (response_format: json_object on every provider), so
// a probe must ask for JSON and the verdict is "did we get a usable object".
const SYS = "You answer only with JSON. No prose, no markdown fences.";
const USER =
  'Classify this message as "spam" or "ham": "CLICK HERE TO WIN A FREE IPHONE NOW!!!". ' +
  'Reply with exactly {"label":"spam"} or {"label":"ham"}.';

/**
 * A provider passes only if it returns a non-empty object with a usable field.
 * An empty object is the signature of a provider that returned 200 with no
 * content, or whose body failed to parse — precisely what the old script
 * reported as success.
 */
function judge(value) {
  if (value == null) return { ok: false, why: "returned null/undefined" };
  if (typeof value !== "object") return { ok: false, why: `returned ${typeof value}, not an object` };
  const keys = Object.keys(value);
  if (keys.length === 0) return { ok: false, why: "returned an empty object (no content / unparseable body)" };
  const label = typeof value.label === "string" ? value.label.toLowerCase() : null;
  if (label && !["spam", "ham"].includes(label)) {
    // Still a live provider — it answered with structure, just not the enum.
    return { ok: true, why: `answered, off-enum label "${value.label}"`, soft: true };
  }
  return { ok: true, why: label ? `label=${label}` : `keys=${keys.slice(0, 3).join(",")}` };
}

const configured = new Set(listAvailableProviders());
const results = [];

for (const p of ALL) {
  if (!configured.has(p)) {
    results.push({ provider: p, state: "unconfigured", ms: 0, detail: `no key — set ${ENV_FOR[p]}` });
    continue;
  }
  const t = Date.now();
  try {
    const value = await callOneProvider(p, SYS, USER, 128);
    const ms = Date.now() - t;
    const v = judge(value);
    results.push({
      provider: p,
      state: v.ok ? (v.soft ? "pass*" : "pass") : "fail",
      ms,
      detail: v.why,
    });
  } catch (err) {
    const msg = String(err?.message ?? err).replace(/\s+/g, " ");
    // Surface the status code prominently — 401 vs 402 vs 429 is the whole
    // difference between "fix the key", "provider went paid", and "wait".
    const status = msg.match(/\b(4\d\d|5\d\d)\b/)?.[1] ?? null;
    results.push({
      provider: p,
      state: "fail",
      ms: Date.now() - t,
      detail: (status ? `HTTP ${status} — ` : "") + msg.slice(0, 150),
    });
  }
}

const live = results.filter((r) => r.state.startsWith("pass"));
const failed = results.filter((r) => r.state === "fail");
const unconfigured = results.filter((r) => r.state === "unconfigured");

if (JSON_OUT) {
  console.log(JSON.stringify({ live: live.map((r) => r.provider), results }, null, 2));
} else {
  const w = Math.max(...ALL.map((p) => p.length));
  console.log("AI provider smoke test — one call per provider, no fallback\n");
  console.log(`${"provider".padEnd(w)}  state        time  detail`);
  console.log("─".repeat(100));
  for (const r of results) {
    const mark = r.state === "pass" ? "✓ pass " : r.state === "pass*" ? "✓ pass*" : r.state === "fail" ? "✗ FAIL " : "– unset";
    console.log(`${r.provider.padEnd(w)}  ${mark}  ${String(r.ms).padStart(5)}ms  ${r.detail}`);
  }
  console.log("─".repeat(100));
  console.log(
    `${live.length} answering · ${failed.length} failing · ${unconfigured.length} not configured ` +
    `(of ${ALL.length} the router knows)`,
  );

  if (failed.length > 0) {
    console.log("\nFailing providers — what each status means:");
    console.log("  401  the key is wrong or revoked. Replace the secret; the router now drops");
    console.log("       a 401 provider for the rest of the process instead of retrying it.");
    console.log("  402  the provider moved off its free tier. Remove the key or accept the loss.");
    console.log("  410  the provider is retired (GitHub Models). Not coming back.");
    console.log("  429  throttled — this one is temporary, try later.");
    console.log("  ECONNREFUSED  the host is unreachable. Expected for ollama outside the owner's box.");
  }
  if (live.length === 0) {
    console.log(
      "\n⚠ NO PROVIDER ANSWERED. Every AI-dependent cron (enrich-news, " +
      "extract-news-events, extract-news-officials, the campaign and intel " +
      "classifiers) will report `ai NONE-ANSWERED` until at least one is fixed. " +
      "See docs/AI_PROVIDERS.md for where to get each key.",
    );
  }
}

// A smoke test that cannot fail is decoration. This one exits non-zero when the
// pool is empty, so it can be wired into a workflow or the staleness pager.
process.exit(live.length > 0 ? 0 : 1);
