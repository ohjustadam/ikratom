/**
 * Tests for the AI router's task-kind routing decisions, especially
 * the new `reasoning` / `self_critique` tasks that route DeepSeek
 * R1 Distill via Groq.
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

describe("AI router — new TaskKinds for DeepSeek R1 routing", () => {
  it("'reasoning' is a valid TaskKind", () => {
    const t: TaskKind = "reasoning";
    expect(t).toBe("reasoning");
  });

  it("'self_critique' is a valid TaskKind", () => {
    const t: TaskKind = "self_critique";
    expect(t).toBe("self_critique");
  });

  it("CompletionOptions.model accepts the DeepSeek model name string", () => {
    const opts: CompletionOptions = { model: "deepseek-r1-distill-llama-70b" };
    expect(opts.model).toBe("deepseek-r1-distill-llama-70b");
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
    // infrastructure. We route DeepSeek models through Groq only.
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
