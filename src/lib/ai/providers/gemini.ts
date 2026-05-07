/**
 * Gemini provider — wraps Google's Generative Language API.
 *
 * Default model: gemini-2.5-flash (free tier, 15 RPM, 1500/day, supports
 * Google Search grounding via tools).
 *
 * Best for: tasks that need fresh web facts (officials lookup, news
 * verification). Don't use for bulk privacy-sensitive work — that's
 * Ollama's job.
 *
 * Auth: GEMINI_API_KEY env var.
 */

import type {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  PromptInput,
  StructuredResult,
  StructuredSchema,
} from "../types";

const KEY = process.env.GEMINI_API_KEY;
const DEFAULT_MODEL = process.env.GEMINI_DEFAULT_MODEL ?? "gemini-2.5-flash";

function flattenPrompt(p: PromptInput): {
  contents: { role: string; parts: { text: string }[] }[];
  systemInstruction?: { parts: { text: string }[] };
} {
  if (typeof p === "string") {
    return { contents: [{ role: "user", parts: [{ text: p }] }] };
  }
  const contents: { role: string; parts: { text: string }[] }[] = [];
  const sysParts: string[] = [];
  for (const m of p) {
    if (m.role === "system") sysParts.push(m.content);
    else contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  return {
    contents,
    systemInstruction: sysParts.length ? { parts: [{ text: sysParts.join("\n\n") }] } : undefined,
  };
}

async function callGemini(model: string, body: object): Promise<{ text: string; usage?: { input?: number; output?: number; total?: number } }> {
  if (!KEY) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Gemini ${r.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    usage: data.usageMetadata
      ? {
          input: data.usageMetadata.promptTokenCount,
          output: data.usageMetadata.candidatesTokenCount,
          total: data.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

export const gemini: AIProvider = {
  name: "gemini",

  async isAvailable() {
    return !!KEY;
  },

  async complete(prompt: PromptInput, opts: CompletionOptions = {}): Promise<CompletionResult> {
    const started = Date.now();
    const model = opts.model ?? DEFAULT_MODEL;
    const { contents, systemInstruction } = flattenPrompt(prompt);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 1024,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    // Pass through extras (e.g. tools for grounding)
    if (opts.extra) Object.assign(body, opts.extra);

    const { text, usage } = await callGemini(model, body);
    return {
      text,
      provider: "gemini",
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
    const { contents, systemInstruction } = flattenPrompt(prompt);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0,
        maxOutputTokens: opts.maxTokens ?? 2048,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (opts.extra) Object.assign(body, opts.extra);

    const { text } = await callGemini(model, body);
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`Gemini JSON parse failed: ${(e as Error).message}; raw: ${text.slice(0, 300)}`);
    }
    return {
      data: parsed,
      provider: "gemini",
      modelUsed: model,
      elapsedMs: Date.now() - started,
      raw: text,
    };
  },
};
