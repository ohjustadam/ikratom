/**
 * Groq provider — wraps Groq Cloud's OpenAI-compatible API.
 *
 * Default model: llama-3.3-70b-versatile (free tier, ~500 tok/sec).
 * Free quota: 30 RPM, 14,400/day. Generous backup for when Gemini hits
 * 1,500/day or when Ollama is unavailable.
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
const DEFAULT_MODEL = process.env.GROQ_DEFAULT_MODEL ?? "llama-3.3-70b-versatile";

function toMessages(p: PromptInput): { role: string; content: string }[] {
  if (typeof p === "string") return [{ role: "user", content: p }];
  return p.map((m) => ({ role: m.role, content: m.content }));
}

async function callGroq(body: object): Promise<{
  text: string;
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
    throw new Error(`Groq ${r.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await r.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
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
    const model = opts.model ?? DEFAULT_MODEL;
    const { text, usage } = await callGroq({
      model,
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
    const model = opts.model ?? DEFAULT_MODEL;
    // Groq supports response_format: { type: "json_object" }. We attach
    // the schema description as a system message so the model targets
    // the right shape.
    const messages = toMessages(prompt);
    messages.unshift({
      role: "system",
      content: `Respond ONLY with JSON matching this schema: ${JSON.stringify(schema)}. No prose, no markdown.`,
    });
    const { text } = await callGroq({
      model,
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
