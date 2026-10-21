import "server-only";

import { complete } from "@/lib/ai/router";
import type { PromptInput } from "@/lib/ai/types";

/**
 * Grounded, free-tier web fact-check for a pending queue item — the in-site
 * (server-reachable) equivalent of scripts/clear-review-queues.mjs. NEVER Claude
 * (router disables it; platform policy).
 *
 * NOTE: we use complete() with the Google Search tool passed via opts.extra —
 * NOT completeStructured(), because the Gemini API forbids combining
 * responseSchema (structured output) with the googleSearch grounding tool. So we
 * ask for JSON in the prompt and parse it defensively.
 *
 * Rules (2026-10-21, same policy as scripts/lib/moderation-gate.mjs): the item's
 * own source is the primary evidence; "couldn't confirm it" is never a reason to
 * reject; intel is news, so an enacted ban is publishable. And a verdict only
 * counts when it was actually GROUNDED: if Gemini is down the router falls back
 * to Groq, which has no search, and an ungrounded "reject" is a guess.
 */

export type FactVerdict = {
  disposition: "approve" | "reject" | "unsure";
  confidence: number; // 0..1
  reason: string;
};

export type FactContext = { summary?: string | null; sourceUrl?: string | null };

const COMMON =
  "You fact-check ONE queued item for iKratom, a strictly NONPARTISAN kratom-advocacy platform, using Google Search. " +
  "Items are built automatically from news, so they can be stale or mis-tagged, but most are real. " +
  "Start from the SOURCE URL when one is given: it is the story the item was built from. Search results that are unrelated prove NOTHING about the event. " +
  "NEVER reject because you could not confirm the event or found little: answer unsure, and a person will look. ";

export const CAMPAIGN_SYSTEM =
  COMMON +
  "This item is a CAMPAIGN: it asks constituents to email their legislators. " +
  "A bill that only passed ONE chamber is still LIVE. " +
  "reject = POSITIVE evidence that the matter is final with nothing left to influence (the bill died, or a ban was signed AND there is no further vote, session, rulemaking, comment period or repeal effort), OR the action is in a DIFFERENT state than the tagged location, OR it is framed around attacking or praising a named politician or party; " +
  "approve = a real, current kratom policy action in the tagged location that constituents can still influence (pending bill, upcoming session or vote, proposed or emergency rule, an official pushing for legislation); " +
  "unsure = anything else. " +
  'Reply with ONLY a JSON object: {"disposition":"approve|reject|unsure","confidence":0..1,"reason":"<=180 chars citing what you found"}.';

export const INTEL_SYSTEM =
  COMMON +
  "This item is INTEL: a public NEWS post. A signed ban, an enacted law, an arrest, a death investigation or a failed bill is still news advocates need, so 'already enacted / nothing to act on' is NEVER a reason to reject intel. " +
  "reject = POSITIVE evidence that the story is not about kratom or 7-OH at all, OR it is in a DIFFERENT state than the tagged location, OR it is partisan framing with no news value; " +
  "approve = a real kratom-related development in the tagged location; " +
  "unsure = anything else. " +
  'Reply with ONLY a JSON object: {"disposition":"approve|reject|unsure","confidence":0..1,"reason":"<=180 chars citing what you found"}.';

function parseVerdict(text: string): Partial<FactVerdict> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Partial<FactVerdict>;
  } catch {
    return null;
  }
}

export async function factCheckItem(
  kind: "campaign" | "intel",
  title: string,
  state: string | null,
  ctx: FactContext = {},
): Promise<FactVerdict> {
  const prompt: PromptInput = [
    { role: "system", content: kind === "intel" ? INTEL_SYSTEM : CAMPAIGN_SYSTEM },
    {
      role: "user",
      content:
        `TYPE: ${kind}\nHEADLINE: ${title}\nTAGGED LOCATION: ${state || "FED/national"}\n` +
        (ctx.sourceUrl ? `SOURCE URL: ${ctx.sourceUrl}\n` : "") +
        (ctx.summary ? `ITEM SUMMARY (AI-written, may be imperfect): ${ctx.summary.slice(0, 600)}\n` : "") +
        `TODAY: ${new Date().toISOString().slice(0, 10)}\nSearch the web, then reply with the JSON verdict only.`,
    },
  ];
  try {
    const { text, provider } = await complete(
      "general",
      prompt,
      { needsGrounding: true },
      { temperature: 0, maxTokens: 500, extra: { tools: [{ google_search: {} }] } },
    );
    if (provider !== "gemini") {
      return { disposition: "unsure", confidence: 0, reason: `not grounded (answered by ${provider}, no web search) — left for review` };
    }
    const d = parseVerdict(text);
    const disposition =
      d?.disposition === "approve" || d?.disposition === "reject" ? d.disposition : "unsure";
    const confidence =
      typeof d?.confidence === "number" && Number.isFinite(d.confidence)
        ? Math.max(0, Math.min(1, d.confidence))
        : 0;
    return { disposition, confidence, reason: String(d?.reason ?? "").slice(0, 300) || "no reason given" };
  } catch {
    return { disposition: "unsure", confidence: 0, reason: "fact-check unavailable (AI/grounding down) — review manually" };
  }
}
