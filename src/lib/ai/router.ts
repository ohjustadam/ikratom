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
    try {
      return await p.complete(prompt, opts);
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
    try {
      return await p.completeStructured<T>(prompt, schema, opts);
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
