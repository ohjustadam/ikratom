/**
 * Ollama provider — talks to a local Ollama HTTP server.
 *
 * Default model: llama3.1:8b (good speed/quality tradeoff).
 * For heavier tasks (bill deep analysis), pass model: 'llama3.3:70b'.
 *
 * No rate limits. Constraint: requires the owner's machine to have
 * Ollama running. `isAvailable()` pings before any call so we degrade
 * gracefully when offline.
 */

import type {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  PromptInput,
  StructuredResult,
  StructuredSchema,
} from "../types";

const DEFAULT_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.1:8b";

function flattenPrompt(p: PromptInput): { prompt: string; system?: string } {
  if (typeof p === "string") return { prompt: p };
  let system: string | undefined;
  const userParts: string[] = [];
  for (const m of p) {
    if (m.role === "system") system = (system ? system + "\n\n" : "") + m.content;
    else if (m.role === "user") userParts.push(m.content);
    else if (m.role === "assistant") userParts.push(`[assistant said]: ${m.content}`);
  }
  return { prompt: userParts.join("\n\n"), system };
}

export const ollama: AIProvider = {
  name: "ollama",

  async isAvailable() {
    try {
      const r = await fetch(`${DEFAULT_HOST}/api/tags`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  },

  async complete(prompt: PromptInput, opts: CompletionOptions = {}): Promise<CompletionResult> {
    const started = Date.now();
    const { prompt: text, system } = flattenPrompt(prompt);
    const model = opts.model ?? DEFAULT_MODEL;
    const r = await fetch(`${DEFAULT_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: text,
        system,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.maxTokens ?? 1024,
          ...(opts.extra ?? {}),
        },
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text().catch(() => "")}`);
    const data = (await r.json()) as { response: string; eval_count?: number; prompt_eval_count?: number };
    return {
      text: data.response,
      provider: "ollama",
      modelUsed: model,
      elapsedMs: Date.now() - started,
      usage: {
        input: data.prompt_eval_count,
        output: data.eval_count,
        total: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  },

  async completeStructured<T>(
    prompt: PromptInput,
    schema: StructuredSchema,
    opts: CompletionOptions = {},
  ): Promise<StructuredResult<T>> {
    const started = Date.now();
    const { prompt: text, system } = flattenPrompt(prompt);
    const model = opts.model ?? DEFAULT_MODEL;
    // Ollama supports `format: 'json'` for forced JSON output. We append
    // the schema as a system instruction so the model knows the shape.
    const schemaInstruction = `Respond ONLY with JSON matching this schema: ${JSON.stringify(schema)}. No prose, no markdown.`;
    const sys = system ? `${system}\n\n${schemaInstruction}` : schemaInstruction;

    const r = await fetch(`${DEFAULT_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: text,
        system: sys,
        stream: false,
        format: "json",
        options: {
          temperature: opts.temperature ?? 0,
          num_predict: opts.maxTokens ?? 2048,
          ...(opts.extra ?? {}),
        },
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text().catch(() => "")}`);
    const data = (await r.json()) as { response: string };
    let parsed: T;
    try {
      parsed = JSON.parse(data.response) as T;
    } catch (e) {
      throw new Error(`Ollama JSON parse failed: ${(e as Error).message}; raw: ${data.response.slice(0, 300)}`);
    }
    return {
      data: parsed,
      provider: "ollama",
      modelUsed: model,
      elapsedMs: Date.now() - started,
      raw: data.response,
    };
  },
};
