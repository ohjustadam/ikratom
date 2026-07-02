/**
 * Shared types for the AI provider toolkit.
 *
 * Design: every provider implements the same `complete()` and
 * `completeStructured()` shape. The router picks one based on TaskKind
 * + constraints declared by the caller. See docs/AI_TOOLKIT.md for the
 * routing rules and provider-to-task table.
 */

export type ProviderName = "ollama" | "gemini" | "groq" | "claude" | "huggingface";

/**
 * Task category — drives routing. Add new kinds here when introducing
 * new AI-backed features. Keep names task-y, not provider-y.
 */
export type TaskKind =
  | "bill_summary"
  | "bill_callout"
  | "bill_deep_analysis"
  | "translate"
  | "officials_lookup"
  | "spam_classify"
  | "moderate_chat"
  | "news_enrich"
  | "story_moderate"
  | "general"
  /** Complex multi-step reasoning. Prefers DeepSeek R1 Distill 70B via Groq for chain-of-thought quality at $0 cost. */
  | "reasoning"
  /** "Did this AI output miss anything?" Phase 3 D5 self-critique target. R1's CoT is well-suited. */
  | "self_critique"
  /** Anti-weaponization: classify whether a campaign email's POSITION
   *  supports or undermines kratom, to gate leader-authored templates. */
  | "email_stance_screen"
  /** Lounge chat ABUSE safety net (harassment/hate/threat/sexual/spam —
   *  never viewpoint). Runs in a Vercel server action, so Groq-first (no
   *  localhost Ollama), mirroring email_stance_screen. */
  | "chat_moderate";

/**
 * Caller-supplied constraints. Empty defaults are fine for most tasks;
 * the router will pick a sensible provider.
 */
export type RouteConstraints = {
  /** Need fresh web facts → must use grounding-capable provider (Gemini). */
  needsGrounding?: boolean;
  /** User PII / chat content / encrypted data → must stay local. */
  privacy?: "any" | "local-only";
  /** Hint for the router when latency matters more than quality. */
  preferSpeed?: boolean;
  /** Force a specific provider (escape hatch — use sparingly). */
  forceProvider?: ProviderName;
};

/** Generic prompt input. Either a single string or a chat-style array. */
export type PromptInput =
  | string
  | { role: "system" | "user" | "assistant"; content: string }[];

export type CompletionOptions = {
  /** Provider-specific model name. Each provider has a sensible default. */
  model?: string;
  /** Temperature 0..1; lower = more deterministic. Default 0.2. */
  temperature?: number;
  /** Max tokens to generate. Default depends on provider. */
  maxTokens?: number;
  /** Provider-specific extras. */
  extra?: Record<string, unknown>;
};

export type CompletionResult = {
  text: string;
  provider: ProviderName;
  modelUsed: string;
  /** Latency in ms. */
  elapsedMs: number;
  /** Token usage if the provider reports it. */
  usage?: { input?: number; output?: number; total?: number };
};

/**
 * Schema for `completeStructured`. We pass a JSON-schema-ish shape; each
 * provider adapts it to its native structured-output mechanism (Gemini
 * `responseSchema`, OpenAI/Groq `response_format`, Ollama prompt-based).
 */
export type StructuredSchema = {
  type: "object" | "array" | "string" | "number" | "boolean";
  properties?: Record<string, StructuredSchema>;
  items?: StructuredSchema;
  required?: string[];
  description?: string;
  enum?: (string | number)[];
};

export type StructuredResult<T> = {
  data: T;
  provider: ProviderName;
  modelUsed: string;
  elapsedMs: number;
  /** Raw text in case caller wants it. */
  raw: string;
};

/**
 * Each provider exports an object matching this contract. The router
 * imports them dynamically so a missing dep (e.g. Groq SDK not installed)
 * doesn't break the whole toolkit.
 */
export interface AIProvider {
  name: ProviderName;
  /** Returns true if this provider is callable right now (env, server up, etc.). */
  isAvailable(): Promise<boolean>;
  complete(prompt: PromptInput, opts?: CompletionOptions): Promise<CompletionResult>;
  completeStructured<T>(
    prompt: PromptInput,
    schema: StructuredSchema,
    opts?: CompletionOptions,
  ): Promise<StructuredResult<T>>;
}

/**
 * Returned by the router when no provider can serve the request (all
 * unavailable / rate-limited / mismatched constraints).
 */
export class NoProviderError extends Error {
  constructor(
    public taskKind: TaskKind,
    public attempted: ProviderName[],
    public lastError?: string,
  ) {
    super(`No provider could serve task=${taskKind}. Tried: ${attempted.join(", ")}. Last: ${lastError ?? "(none)"}`);
    this.name = "NoProviderError";
  }
}
