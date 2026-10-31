/**
 * Groq provider — wraps Groq Cloud's OpenAI-compatible API.
 *
 * Default model: the members' model, openai/gpt-oss-20b (see MEMBER_MODEL below).
 * Free quota is per MODEL: gpt-oss-120b allows 1,000 requests and 200k tokens
 * a day, 8k tokens a minute (read from Groq's headers and 429s, 2026-10-31).
 *
 * **Also supports DeepSeek R1 Distill Llama-70B** when callers (or the
 * router's per-task model override) pass `model: "deepseek-r1-distill-llama-70b"`.
 * Used for reasoning / self_critique TaskKinds. Routes through Groq's
 * US infrastructure — we never hit DeepSeek's own (Chinese-server) API
 * because their ToS allows training on submitted data.
 *
 * Auth: GROQ_API_KEY env var. No SDK; raw HTTP — keeps the dep tree
 * minimal and there's nothing tricky about Groq's API surface.
 */

import type {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  PromptInput,
  StructuredResult,
  StructuredSchema,
} from "../types";

const KEY = process.env.GROQ_API_KEY;
// Every site call is a member or admin waiting, so the site runs on the
// members' model. Groq meters each model's daily tokens separately, and the
// background jobs spend gpt-oss-120b's 200k by mid-day (198,983 used on
// 2026-10-31): letter screening, campaign screening and chat moderation were
// failing every afternoon, falling through to a Gemini key that is out of
// credits. The jobs never use this model (scripts/lib/ai-router-support.mjs,
// MEMBER_DEFAULT). History: llama-3.3-70b-versatile was retired 2026-10-22.
const MEMBER_MODEL = process.env.GROQ_MODEL_MEMBER ?? "openai/gpt-oss-20b";
const DEFAULT_MODEL = process.env.GROQ_DEFAULT_MODEL ?? MEMBER_MODEL;

function toMessages(p: PromptInput): { role: string; content: string }[] {
  if (typeof p === "string") return [{ role: "user", content: p }];
  return p.map((m) => ({ role: m.role, content: m.content }));
}

async function callGroq(body: { model: string } & Record<string, unknown>): Promise<{
  text: string;
  model: string;
  usage?: { input?: number; output?: number; total?: number };
}> {
  if (!KEY) throw new Error("GROQ_API_KEY not set");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    // A model out of its allowance (a per-task override such as gpt-oss-120b,
    // which the jobs share) gets one more try on the members' model, which has
    // its own daily budget.
    if (r.status === 429 && body.model !== MEMBER_MODEL) return callGroq({ ...body, model: MEMBER_MODEL });
    throw new Error(`Groq ${r.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await r.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    model: body.model,
    usage: data.usage
      ? {
          input: data.usage.prompt_tokens,
          output: data.usage.completion_tokens,
          total: data.usage.total_tokens,
        }
      : undefined,
  };
}

export const groq: AIProvider = {
  name: "groq",

  async isAvailable() {
    return !!KEY;
  },

  async complete(prompt: PromptInput, opts: CompletionOptions = {}): Promise<CompletionResult> {
    const started = Date.now();
    const { text, usage, model } = await callGroq({
      model: opts.model ?? DEFAULT_MODEL,
      messages: toMessages(prompt),
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.extra ?? {}),
    });
    return {
      text,
      provider: "groq",
      modelUsed: model,
      elapsedMs: Date.now() - started,
      usage,
    };
  },

  async completeStructured<T>(
    prompt: PromptInput,
    schema: StructuredSchema,
    opts: CompletionOptions = {},
  ): Promise<StructuredResult<T>> {
    const started = Date.now();
    // Groq supports response_format: { type: "json_object" }. We attach
    // the schema description as a system message so the model targets
    // the right shape.
    const messages = toMessages(prompt);
    messages.unshift({
      role: "system",
      content: `Respond ONLY with JSON matching this schema: ${JSON.stringify(schema)}. No prose, no markdown.`,
    });
    const { text, model } = await callGroq({
      model: opts.model ?? DEFAULT_MODEL,
      messages,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 2048,
      response_format: { type: "json_object" },
      ...(opts.extra ?? {}),
    });
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`Groq JSON parse failed: ${(e as Error).message}; raw: ${text.slice(0, 300)}`);
    }
    return {
      data: parsed,
      provider: "groq",
      modelUsed: model,
      elapsedMs: Date.now() - started,
      raw: text,
    };
  },
};
