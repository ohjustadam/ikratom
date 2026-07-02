import "server-only";

import { completeStructured } from "@/lib/ai/router";
import type { PromptInput, StructuredSchema } from "@/lib/ai/types";

/**
 * Lounge chat ABUSE moderation (anti-weaponization D4).
 *
 * The AI router's moderation task was unlocked in #599 but never invoked —
 * postChatMessage ran only non-AI gates (flood / URL / mute / rate / dupe).
 * This is the AI safety net that runs on top of them.
 *
 * SCOPE — abuse only, NEVER viewpoint. The lounge is community speech; a user
 * arguing an anti-kratom position, criticizing an org, or being blunt is NOT a
 * violation. We flag only harassment, hate, threats, sexual content, and spam.
 * (Stance screening — "does this message undermine kratom" — applies ONLY to
 * OUTBOUND campaign email, where iKratom is the sender: see screen-content.ts.)
 *
 * Free-tier only: routes via the `chat_moderate` task → Groq primary, Gemini
 * fallback (no Ollama — this runs in a Vercel server action). Lounge messages
 * are already community-visible, so cloud inference is not a privacy regression.
 *
 * FAIL OPEN: the caller screens BEFORE insert and only diverts a message on a
 * confident abuse verdict. If the screener errors or times out, `flagged` is
 * false — the message posts normally. We never silence speech because the AI
 * was slow or down.
 */

export type AbuseCategory =
  | "none"
  | "harassment"
  | "hate"
  | "threat"
  | "sexual"
  | "spam"
  | "other";

export type ModerationResult = {
  /** true → divert to the admin hold queue instead of posting. */
  flagged: boolean;
  category: AbuseCategory;
  reason: string;
  /** 0..1 confidence in the abuse call. */
  confidence: number;
  /** true → screening couldn't run (AI unavailable/slow); caller fails open. */
  errored: boolean;
};

const CATEGORIES: AbuseCategory[] = ["none", "harassment", "hate", "threat", "sexual", "spam", "other"];

const SCHEMA: StructuredSchema = {
  type: "object",
  properties: {
    abusive: { type: "boolean", description: "true only if the message is genuinely abusive per the categories." },
    category: {
      type: "string",
      enum: CATEGORIES,
      description:
        "none: not abusive (includes political disagreement, anti-kratom opinions, bluntness, criticism of orgs — these are NOT abuse). " +
        "harassment: targeted insults/degradation of a person. hate: attacks on a protected class. threat: threats of violence/harm. " +
        "sexual: sexual content/solicitation. spam: unsolicited advertising/scam/repetitive junk. other: clearly abusive but none of the above.",
    },
    confidence: { type: "number", description: "0..1 confidence in the abuse call." },
    reason: { type: "string", description: "One short sentence justifying the call." },
  },
  required: ["abusive", "category", "confidence", "reason"],
};

const SYSTEM =
  "You are an abuse-only content moderator for the iKratom community lounge (a chat room for kratom advocates). " +
  "Flag ONLY genuinely abusive messages: harassment, hate speech, threats, sexual content, or spam. " +
  "Do NOT flag opinions, political disagreement, anti-kratom viewpoints, criticism of organizations, profanity used for emphasis, " +
  "or blunt/heated-but-civil argument — those are protected community speech. When unsure, return abusive=false. " +
  "Return only the structured JSON.";

const FLAG_THRESHOLD = 0.75;
const TIMEOUT_MS = 2500;

type RawVerdict = { abusive?: boolean; category?: string; confidence?: number; reason?: string };

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Screen one lounge message for abuse. Returns flagged=true only on a confident
 * abuse verdict; fails open (flagged=false, errored=true) on any error/timeout.
 */
export async function moderateChatMessage(body: string): Promise<ModerationResult> {
  const prompt: PromptInput = [
    { role: "system", content: SYSTEM },
    { role: "user", content: body.slice(0, 2000) },
  ];

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("moderation_timeout")), TIMEOUT_MS),
    );
    const { data } = await Promise.race([
      completeStructured<RawVerdict>("chat_moderate", prompt, SCHEMA, {}, { temperature: 0 }),
      timeout,
    ]);

    const abusive = data?.abusive === true;
    const category = (CATEGORIES.includes(data?.category as AbuseCategory) ? data!.category : "other") as AbuseCategory;
    const confidence = clamp01(data?.confidence);
    const reason = (typeof data?.reason === "string" ? data.reason : "").slice(0, 300) || "no reason given";
    const flagged = abusive && category !== "none" && confidence >= FLAG_THRESHOLD;
    return { flagged, category: flagged ? category : "none", reason, confidence, errored: false };
  } catch {
    // Fail open — never silence speech because the screener was slow or down.
    return { flagged: false, category: "none", reason: "screening unavailable", confidence: 0, errored: true };
  }
}
