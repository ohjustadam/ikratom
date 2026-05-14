/**
 * Provider router — picks the right AI for a given task.
 *
 * Decision tree (see docs/AI_TOOLKIT.md for the full playbook):
 *   1. forceProvider set → that, no questions asked
 *   2. privacy='local-only' → ollama only; fail if unavailable
 *   3. needsGrounding → gemini primary, groq fallback (with manual fetch)
 *   4. preferSpeed → groq primary, ollama fallback
 *   5. else → ollama primary (free, unlimited), groq fallback, gemini last
 *
 * Each call:
 *   - tries the picked provider
 *   - on rate limit / network error, tries the next-best per the rules
 *   - aggregates errors into a NoProviderError if all fail
 *
 * The router does NOT log to the database — that's the responsibility of
 * `src/modules/ai/jobs.ts` (when implemented). Keeps this layer pure.
 */

import { ollama } from "./providers/ollama";
import { gemini } from "./providers/gemini";
import { groq } from "./providers/groq";
import {
  type AIProvider,
  type CompletionOptions,
  type CompletionResult,
  type PromptInput,
  type ProviderName,
  type RouteConstraints,
  type StructuredResult,
  type StructuredSchema,
  type TaskKind,
  NoProviderError,
} from "./types";

const REGISTRY: Record<ProviderName, AIProvider | null> = {
  ollama,
  gemini,
  groq,
  claude: null, // we ARE claude — placeholder
  huggingface: null, // not yet implemented
};

/**
 * Default provider preference per task. Router applies constraints on top.
 */
const TASK_DEFAULTS: Record<TaskKind, ProviderName[]> = {
  bill_summary: ["ollama", "groq", "gemini"],
  bill_callout: ["ollama", "groq", "gemini"],
  bill_deep_analysis: ["ollama", "groq"], // local preferred for bulk; 70b model used
  translate: ["ollama", "groq"],
  officials_lookup: ["gemini"], // grounding required
  spam_classify: ["ollama", "groq"], // privacy: user content
  moderate_chat: ["ollama"], // privacy: locked to local
  news_enrich: ["ollama", "groq", "gemini"],
  story_moderate: ["ollama"], // privacy: user submitted
  general: ["ollama", "groq", "gemini"],
  // Reasoning / self-critique route through Groq (US-hosted, free tier)
  // with a reasoning-capable model override (see TASK_MODEL_OVERRIDES).
  // Gemini stays as grounded-fact-check fallback.
  reasoning: ["groq", "gemini", "ollama"],
  self_critique: ["groq", "gemini"],
};

/**
 * Per-task model override. When the router picks a provider listed
 * here, it passes this model name in opts.model (overriding the
 * provider's default).
 *
 * Why this layer exists: some tasks want a SPECIFIC model on a given
 * provider — e.g. OpenAI's open-weights GPT-OSS-120B via Groq for
 * reasoning tasks (better chain-of-thought than vanilla Llama 3.3 at
 * the same $0 cost).
 *
 * History (don't repeat): we originally routed these tasks to
 * `deepseek-r1-distill-llama-70b` via Groq. Groq decommissioned that
 * model on 2026-04 ("deepseek-r1-distill-llama-70b has been
 * decommissioned" — see https://console.groq.com/docs/deprecations).
 * We switched to GPT-OSS-120B which Groq now offers in its place:
 * also open-weights (MIT), also reasoning-capable (returns explicit
 * `reasoning_tokens` in usage), still US-hosted, still $0.
 *
 * Privacy guarantee we keep regardless of model choice: we NEVER hit
 * DeepSeek's own API (Chinese infrastructure, ToS allows training on
 * submitted data). All "open-weights" reasoning models we use are
 * routed via Groq/Cerebras/HuggingFace serving on US infrastructure.
 * The `deepseek` ProviderName is intentionally banned at the type
 * level — see tests/ai-router-routing.test.ts.
 */
const TASK_MODEL_OVERRIDES: Partial<Record<TaskKind, Partial<Record<ProviderName, string>>>> = {
  reasoning: {
    groq: "openai/gpt-oss-120b",
  },
  self_critique: {
    groq: "openai/gpt-oss-120b",
  },
};

/**
 * Pick an ordered list of provider candidates for this task + constraints.
 */
function planRoute(taskKind: TaskKind, c: RouteConstraints): ProviderName[] {
  if (c.forceProvider) return [c.forceProvider];

  if (c.privacy === "local-only") return ["ollama"];

  if (c.needsGrounding) return ["gemini", "groq"]; // groq is fallback w/o grounding — caller knows

  if (c.preferSpeed) {
    // Groq is the fastest available option for OSS models
    const def = TASK_DEFAULTS[taskKind];
    return ["groq", ...def.filter((p) => p !== "groq")];
  }

  return TASK_DEFAULTS[taskKind];
}

async function pickAvailable(candidates: ProviderName[]): Promise<AIProvider | null> {
  for (const name of candidates) {
    const p = REGISTRY[name];
    if (!p) continue;
    if (await p.isAvailable()) return p;
  }
  return null;
}

/**
 * Plain text completion. Falls back through the candidate list on error.
 */
export async function complete(
  taskKind: TaskKind,
  prompt: PromptInput,
  c: RouteConstraints = {},
  opts: CompletionOptions = {},
): Promise<CompletionResult> {
  const candidates = planRoute(taskKind, c);
  const errors: string[] = [];
  for (const name of candidates) {
    const p = REGISTRY[name];
    if (!p) continue;
    if (!(await p.isAvailable())) {
      errors.push(`${name}: unavailable`);
      continue;
    }
    // Apply per-task model override (e.g. GPT-OSS-120B for reasoning
    // tasks via Groq). Caller's opts.model wins if explicitly set.
    const taskOverride = TASK_MODEL_OVERRIDES[taskKind]?.[name];
    const effectiveOpts: CompletionOptions =
      opts.model || !taskOverride ? opts : { ...opts, model: taskOverride };
    try {
      return await p.complete(prompt, effectiveOpts);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
      continue;
    }
  }
  throw new NoProviderError(taskKind, candidates, errors.join(" | "));
}

/**
 * Structured (JSON-schema constrained) completion with the same fallback chain.
 */
export async function completeStructured<T>(
  taskKind: TaskKind,
  prompt: PromptInput,
  schema: StructuredSchema,
  c: RouteConstraints = {},
  opts: CompletionOptions = {},
): Promise<StructuredResult<T>> {
  const candidates = planRoute(taskKind, c);
  const errors: string[] = [];
  for (const name of candidates) {
    const p = REGISTRY[name];
    if (!p) continue;
    if (!(await p.isAvailable())) {
      errors.push(`${name}: unavailable`);
      continue;
    }
    const taskOverride = TASK_MODEL_OVERRIDES[taskKind]?.[name];
    const effectiveOpts: CompletionOptions =
      opts.model || !taskOverride ? opts : { ...opts, model: taskOverride };
    try {
      return await p.completeStructured<T>(prompt, schema, effectiveOpts);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
      continue;
    }
  }
  throw new NoProviderError(taskKind, candidates, errors.join(" | "));
}

/**
 * Helper for callers who want to know what's available right now.
 */
export async function whichAvailable(): Promise<ProviderName[]> {
  const names: ProviderName[] = ["ollama", "gemini", "groq"];
  const out: ProviderName[] = [];
  for (const n of names) {
    const p = REGISTRY[n];
    if (p && (await p.isAvailable())) out.push(n);
  }
  return out;
}

export { pickAvailable };
