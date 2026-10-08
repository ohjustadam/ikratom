"use server";

import { runAi } from "@/lib/ai/jobs";
import { getAdminContext } from "./actions";
import type { ProviderName } from "@/lib/ai/types";

/**
 * Admin-only prompt sandbox. Lets the owner iterate on prompts in
 * /admin/ai-control without writing code or touching the database.
 *
 * Every test run goes through runAi() so it shows up in the ai_jobs
 * log alongside production calls — auditable + cost-tracked.
 */

const PROVIDERS: ProviderName[] = ["ollama", "groq", "gemini"];
const MAX_PROMPT_CHARS = 8000;

export async function runTestPrompt(input: {
  systemPrompt: string;
  userPrompt: string;
  forceProvider?: string;
}) {
  const ctx = await getAdminContext({ require: "use_ai_editor" });
  if (!ctx.ok) return { error: "Admins only." };

  const sys = (input.systemPrompt ?? "").slice(0, MAX_PROMPT_CHARS);
  const usr = (input.userPrompt ?? "").slice(0, MAX_PROMPT_CHARS);
  if (!usr.trim()) return { error: "User prompt is required." };

  const force = input.forceProvider && PROVIDERS.includes(input.forceProvider as ProviderName)
    ? (input.forceProvider as ProviderName)
    : undefined;

  try {
    const result = await runAi(
      "general",
      [
        ...(sys.trim() ? [{ role: "system" as const, content: sys }] : []),
        { role: "user" as const, content: usr },
      ],
      { caller: "admin:test-prompt" },
      force ? { forceProvider: force } : {},
      { temperature: 0.2, maxTokens: 1500 },
    );
    return {
      ok: true,
      provider: result.provider,
      model: result.modelUsed,
      elapsedMs: result.elapsedMs,
      text: result.text,
      tokens: result.usage,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
