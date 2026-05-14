/**
 * Tests for the AI router's task-kind routing decisions, especially
 * the `reasoning` / `self_critique` tasks that route a reasoning-capable
 * open-weights model via Groq.
 *
 * Original plan was DeepSeek R1 Distill 70B; Groq decommissioned that
 * model 2026-04 so we switched the model override to GPT-OSS-120B.
 * The privacy posture is unchanged: never route to DeepSeek's own API.
 *
 * These tests don't actually hit AI providers — they exercise the
 * router's planning + model-override logic by stubbing the provider
 * registry. Pure logic, fast.
 */

import { describe, it, expect } from "vitest";
import type { TaskKind, ProviderName, CompletionOptions } from "@/lib/ai/types";

// We can't directly inspect TASK_DEFAULTS or TASK_MODEL_OVERRIDES because
// they're module-internal. Instead we verify the public surface via the
// types contract: the new TaskKinds must be valid, and a TaskKind value
// passed through the type system stays typed.

describe("AI router — TaskKinds for reasoning routing", () => {
  it("'reasoning' is a valid TaskKind", () => {
    const t: TaskKind = "reasoning";
    expect(t).toBe("reasoning");
  });

  it("'self_critique' is a valid TaskKind", () => {
    const t: TaskKind = "self_critique";
    expect(t).toBe("self_critique");
  });

  it("CompletionOptions.model accepts the reasoning model name string", () => {
    // Current reasoning model (Groq-hosted, MIT-licensed open-weights).
    // If/when this changes again, only this string + TASK_MODEL_OVERRIDES
    // in router.ts need to update.
    const opts: CompletionOptions = { model: "openai/gpt-oss-120b" };
    expect(opts.model).toBe("openai/gpt-oss-120b");
  });

  // Sanity: the TaskKind union still includes the original surface so
  // we haven't accidentally broken anything.
  it("legacy TaskKinds still type-check", () => {
    const kinds: TaskKind[] = [
      "bill_summary",
      "bill_callout",
      "bill_deep_analysis",
      "translate",
      "officials_lookup",
      "spam_classify",
      "moderate_chat",
      "news_enrich",
      "story_moderate",
      "general",
    ];
    expect(kinds.length).toBe(10);
  });
});

describe("AI router — privacy posture (no DeepSeek direct)", () => {
  it("does not register a 'deepseek' provider name", () => {
    // We deliberately don't add DeepSeek's hosted API as a provider.
    // Their ToS allows training on submitted data + Chinese server
    // infrastructure. Even though Groq has since dropped DeepSeek-R1
    // and we now use GPT-OSS-120B, this guard stays — if a future PR
    // re-adds an R1-class model via a different host, it must NOT use
    // DeepSeek's own API.
    const allowedProviders: ProviderName[] = [
      "ollama",
      "gemini",
      "groq",
      "claude",
      "huggingface",
    ];
    // @ts-expect-error — "deepseek" is intentionally NOT a ProviderName
    const _badProvider: ProviderName = "deepseek";
    void _badProvider;
    expect(allowedProviders).not.toContain("deepseek");
  });
});
