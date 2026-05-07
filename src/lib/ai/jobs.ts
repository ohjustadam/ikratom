/**
 * Logged wrapper around the AI router.
 *
 * Use this instead of the raw `complete()` / `completeStructured()` from
 * router.ts when you want the call recorded in the `ai_jobs` table for
 * the AI Command Center dashboard. The raw router stays uninstrumented
 * so unit tests / scripts that don't care about logging can use it
 * cleanly.
 *
 * Usage:
 *   import { runAi, runAiStructured } from "@/lib/ai/jobs";
 *   const result = await runAi("translate", prompt, { caller: "translate-content.mjs" });
 *
 * Logging is best-effort: if the ai_jobs insert fails, the AI call
 * itself still returns. We never let observability take down a real
 * task.
 */

import { complete, completeStructured } from "./router";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  CompletionOptions,
  CompletionResult,
  PromptInput,
  RouteConstraints,
  StructuredResult,
  StructuredSchema,
  TaskKind,
} from "./types";

const PREVIEW_LIMIT = 800;

export type AiCallContext = {
  /** Identifier for who called this — script name, route path, etc. */
  caller?: string;
  /** Logged-in user's id, if applicable. */
  userId?: string;
  /** Extra data to store as JSONB metadata on the job row. */
  metadata?: Record<string, unknown>;
};

/** Cost-per-token estimates (USD). Best effort; null = unknown / free. */
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.075 / 1000, output: 0.30 / 1000 }, // per 1k = 0.000075/0.0003 per token
  "groq-llama-3.3-70b": { input: 0.59 / 1_000_000, output: 0.79 / 1_000_000 },
  "groq-llama-3.1-8b": { input: 0.05 / 1_000_000, output: 0.08 / 1_000_000 },
  "ollama": { input: 0, output: 0 }, // local, only electricity
};

function estimateCost(provider: string | undefined, modelUsed: string | undefined, inTok?: number, outTok?: number): number | null {
  if (provider === "ollama") return 0;
  // Try model-specific lookup first, then fall back to provider key
  const key = (modelUsed && COST_PER_1K_TOKENS[modelUsed]) ? modelUsed : provider ?? "";
  const rate = COST_PER_1K_TOKENS[key];
  if (!rate) return null;
  const cost = (inTok ?? 0) * rate.input + (outTok ?? 0) * rate.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function previewPrompt(prompt: PromptInput): string {
  if (typeof prompt === "string") return prompt.slice(0, PREVIEW_LIMIT);
  // Chat-style — concat with role tags
  return prompt
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n")
    .slice(0, PREVIEW_LIMIT);
}

async function logJob(row: {
  task_kind: string;
  provider_used?: string;
  model_used?: string;
  status: "success" | "failure";
  prompt_preview: string;
  output_preview?: string;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd?: number | null;
  elapsed_ms?: number;
  error?: string;
  caller?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from("ai_jobs").insert({
      ...row,
      completed_at: new Date().toISOString(),
    });
  } catch {
    // swallow — logging never blocks the call
  }
}

/** Logged version of `complete()`. */
export async function runAi(
  taskKind: TaskKind,
  prompt: PromptInput,
  ctx: AiCallContext = {},
  constraints: RouteConstraints = {},
  opts: CompletionOptions = {},
): Promise<CompletionResult> {
  const promptPreview = previewPrompt(prompt);
  try {
    const result = await complete(taskKind, prompt, constraints, opts);
    await logJob({
      task_kind: taskKind,
      provider_used: result.provider,
      model_used: result.modelUsed,
      status: "success",
      prompt_preview: promptPreview,
      output_preview: result.text.slice(0, PREVIEW_LIMIT),
      tokens_input: result.usage?.input,
      tokens_output: result.usage?.output,
      cost_usd: estimateCost(result.provider, result.modelUsed, result.usage?.input, result.usage?.output),
      elapsed_ms: result.elapsedMs,
      caller: ctx.caller,
      user_id: ctx.userId,
      metadata: { ...ctx.metadata, constraints },
    });
    return result;
  } catch (e) {
    const err = (e as Error).message;
    await logJob({
      task_kind: taskKind,
      status: "failure",
      prompt_preview: promptPreview,
      error: err,
      caller: ctx.caller,
      user_id: ctx.userId,
      metadata: { ...ctx.metadata, constraints },
    });
    throw e;
  }
}

/** Logged version of `completeStructured()`. */
export async function runAiStructured<T>(
  taskKind: TaskKind,
  prompt: PromptInput,
  schema: StructuredSchema,
  ctx: AiCallContext = {},
  constraints: RouteConstraints = {},
  opts: CompletionOptions = {},
): Promise<StructuredResult<T>> {
  const promptPreview = previewPrompt(prompt);
  try {
    const result = await completeStructured<T>(taskKind, prompt, schema, constraints, opts);
    await logJob({
      task_kind: taskKind,
      provider_used: result.provider,
      model_used: result.modelUsed,
      status: "success",
      prompt_preview: promptPreview,
      output_preview: result.raw.slice(0, PREVIEW_LIMIT),
      elapsed_ms: result.elapsedMs,
      caller: ctx.caller,
      user_id: ctx.userId,
      metadata: { ...ctx.metadata, constraints, structured: true },
    });
    return result;
  } catch (e) {
    const err = (e as Error).message;
    await logJob({
      task_kind: taskKind,
      status: "failure",
      prompt_preview: promptPreview,
      error: err,
      caller: ctx.caller,
      user_id: ctx.userId,
      metadata: { ...ctx.metadata, constraints, structured: true },
    });
    throw e;
  }
}
