import "server-only";

import { completeStructured } from "@/lib/ai/router";
import type { PromptInput, StructuredSchema } from "@/lib/ai/types";
import { letterThreat } from "@/lib/letter-threats";

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

// ── Member letters (owner rules, 2026-10-22) ────────────────────────────────
//
// Since 2026-10-21 one-click sends the letter a MEMBER wrote, not only a
// screened template, so member text is screened before it leaves through
// iKratom. The template screen above is the wrong rule for this: it treats ANY
// restriction as off-mission, which would block a letter backing the KCPA's own
// position (restrict concentrated/synthetic 7-OH, protect the leaf).
//
// Rules, in the owner's words:
//   - always block threats, harassment and slurs;
//   - block letters that call for banning natural kratom;
//   - ALLOW restricting synthetic or concentrated 7-OH while protecting the leaf.
// If the AI screen is unreachable we still run the threat patterns and then
// let the letter through: a provider outage must not stop members acting.

export type LetterScreen = { block: boolean; category: "ok" | "threat" | "bans_natural_kratom"; message: string };

const LETTER_SCHEMA: StructuredSchema = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: ["ok", "threat", "bans_natural_kratom"],
      description:
        "threat: threatens, harasses, intimidates, or uses slurs against the recipient or anyone. " +
        "bans_natural_kratom: argues FOR banning, scheduling or criminalizing natural/leaf kratom. " +
        "ok: everything else, INCLUDING letters that support restricting or banning synthetic, " +
        "semi-synthetic or concentrated 7-OH products while protecting natural leaf, age limits, " +
        "labeling, testing, KCPA-style regulation, and civil criticism of an official's position.",
    },
    confidence: { type: "number", description: "0..1 confidence." },
    reason: { type: "string", description: "One short, polite sentence explaining the call to the writer." },
  },
  required: ["category", "confidence", "reason"],
};

const LETTER_SYSTEM =
  "You screen letters that members of iKratom, a kratom-advocacy platform, send to their elected officials. " +
  "Classify the letter with the schema. Be careful and fair: firm, angry or blunt political criticism is ok; " +
  "only real threats, harassment or slurs are 'threat'. Supporting limits on concentrated or synthetic 7-OH " +
  "while protecting the natural leaf is ok, not a ban. When unsure, answer ok. Return only the JSON.";

const MESSAGES: Record<Exclude<LetterScreen["category"], "ok">, string> = {
  threat:
    "This letter reads as threatening or harassing, so iKratom can't send it. Please rephrase it as a firm, respectful request.",
  bans_natural_kratom:
    "This letter asks for natural kratom to be banned. iKratom only sends letters that protect access to the natural leaf (limits on synthetic or concentrated 7-OH are fine).",
};

/** Screen a member's own letter. Blocks only at high confidence or on a clear threat pattern. */
export async function screenMemberLetter(input: { subject: string; body: string }): Promise<LetterScreen> {
  const text = `${input.subject}\n${input.body}`;
  if (letterThreat(text)) return { block: true, category: "threat", message: MESSAGES.threat };
  try {
    const { data } = await completeStructured<{ category: string; confidence: number; reason: string }>(
      "email_stance_screen",
      [
        { role: "system", content: LETTER_SYSTEM },
        { role: "user", content: `Subject: ${input.subject}\n\nLetter:\n${input.body}`.slice(0, 8000) },
      ],
      LETTER_SCHEMA,
      {},
      { temperature: 0 },
    );
    const category = data?.category === "threat" || data?.category === "bans_natural_kratom" ? data.category : "ok";
    if (category !== "ok" && clamp01(data?.confidence) >= 0.7) {
      return { block: true, category, message: MESSAGES[category] };
    }
    return { block: false, category: "ok", message: "" };
  } catch {
    return { block: false, category: "ok", message: "" }; // outage: threat patterns already ran
  }
}
