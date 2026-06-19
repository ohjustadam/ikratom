import "server-only";

import { completeStructured } from "@/lib/ai/router";
import type { PromptInput, StructuredSchema } from "@/lib/ai/types";

/**
 * Outbound-email stance screening (anti-weaponization PR3).
 *
 * iKratom must never become the instrument for an anti-kratom message. The
 * blessed send paths (one-click platform_email, waves) only ever transmit a
 * campaign's canonical template, so the one place hostile content could enter
 * at scale is campaign AUTHORSHIP — we screen the template there.
 *
 * Free-tier only (platform policy): routes via the AI router's
 * `email_stance_screen` task → Groq primary, Gemini fallback, never a paid
 * API. Ollama is excluded for prod safety (server actions on Vercel can't
 * reach a localhost model).
 *
 * Philosophy: SOFT gate. We never silently block speech — a flagged template
 * is routed to the human review queue, and an unreachable screener fails SAFE
 * (to review), never to auto-publish.
 */

export type Stance = "supports_kratom" | "off_mission" | "neutral" | "unclear";

export type StanceVerdict = {
  stance: Stance;
  /** 0..1 confidence in the stance call. */
  confidence: number;
  /** One short sentence justifying the call (shown in the review queue). */
  reason: string;
};

export type ScreenResult = {
  /** true → safe to publish without human review. */
  pass: boolean;
  verdict: StanceVerdict;
  /** true → screening couldn't run (AI unavailable); caller routes to review. */
  errored: boolean;
};

const SCHEMA: StructuredSchema = {
  type: "object",
  properties: {
    stance: {
      type: "string",
      enum: ["supports_kratom", "off_mission", "neutral", "unclear"],
      description:
        "supports_kratom: argues to protect/preserve access to kratom or 7-OH, oppose a ban, or fix an overbroad bill. " +
        "off_mission: argues to ban, schedule, criminalize, or restrict kratom/7-OH, or frames kratom as dangerous. " +
        "neutral: purely procedural/informational, no position on legality. unclear: not enough signal.",
    },
    confidence: { type: "number", description: "0..1 confidence in the stance call." },
    reason: { type: "string", description: "One short sentence justifying the call." },
  },
  required: ["stance", "confidence", "reason"],
};

const SYSTEM =
  "You are a content screener for iKratom, a kratom-advocacy platform. Advocates use it to email " +
  "legislators in DEFENSE of kratom and 7-hydroxymitragynine ('7-OH') — to keep them legal and " +
  "accessible. Classify the substantive POSITION the email takes toward kratom/7-OH using the schema. " +
  "Judge the message's position, NOT its politeness or tone: a courteous email that concedes kratom " +
  "should be banned or restricted is off_mission. Return only the structured JSON.";

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

function normalize(d: Partial<StanceVerdict> | null | undefined): StanceVerdict {
  const allowed: Stance[] = ["supports_kratom", "off_mission", "neutral", "unclear"];
  const stance = allowed.includes(d?.stance as Stance) ? (d!.stance as Stance) : "unclear";
  return {
    stance,
    confidence: clamp01(d?.confidence),
    reason: (typeof d?.reason === "string" ? d.reason : "").slice(0, 300) || "no reason given",
  };
}

/**
 * Screen a campaign's subject + body. `pass` is true only for clearly
 * on-mission or neutral content at reasonable confidence; anything reading as
 * anti-kratom — or low-confidence / unclear — returns pass=false so the caller
 * routes it to human review.
 */
export async function screenCampaignTemplate(input: {
  title?: string;
  subject: string;
  body: string;
}): Promise<ScreenResult> {
  const prompt: PromptInput = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: (
        (input.title ? `Campaign: ${input.title}\n\n` : "") +
        `Subject: ${input.subject}\n\nBody:\n${input.body}`
      ).slice(0, 8000),
    },
  ];

  try {
    const { data } = await completeStructured<StanceVerdict>(
      "email_stance_screen",
      prompt,
      SCHEMA,
      {},
      { temperature: 0 },
    );
    const verdict = normalize(data);
    const pass =
      (verdict.stance === "supports_kratom" || verdict.stance === "neutral") &&
      verdict.confidence >= 0.6;
    return { pass, verdict, errored: false };
  } catch {
    // Fail SAFE: if no free-tier provider can serve the screen, do NOT
    // auto-publish — route to human review.
    return {
      pass: false,
      verdict: { stance: "unclear", confidence: 0, reason: "screening unavailable" },
      errored: true,
    };
  }
}
