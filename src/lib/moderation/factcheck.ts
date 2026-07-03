import "server-only";

import { complete } from "@/lib/ai/router";
import type { PromptInput } from "@/lib/ai/types";

/**
 * Grounded, free-tier web fact-check for a pending queue item — the in-site
 * (Vercel-reachable) equivalent of scripts/clear-review-queues.mjs's SearXNG
 * pass. NEVER Claude (router disables it; platform policy).
 *
 * NOTE: we use complete() with the Google Search tool passed via opts.extra —
 * NOT completeStructured(), because the Gemini API forbids combining
 * responseSchema (structured output) with the googleSearch grounding tool. So we
 * ask for JSON in the prompt and parse it defensively. If grounding is
 * unavailable, the router falls back to Groq (ungrounded) and we fail SAFE to
 * "unsure" (never an unattended reject).
 */

export type FactVerdict = {
  disposition: "approve" | "reject" | "unsure";
  confidence: number; // 0..1
  reason: string;
};

const SYSTEM =
  "You fact-check a pending item for iKratom, a strictly NONPARTISAN kratom-advocacy platform, using Google Search. " +
  "Items are AI-scraped from news and may be stale, mis-located, or hallucinated. " +
  "A bill that only passed ONE chamber is still LIVE; only 'signed into law / enacted' or 'died / failed / tabled / sine die' is terminal. " +
  "Decide: approve = the event is real, current, correctly located for the tagged state, nonpartisan, and any bill is still live; " +
  "reject = already enacted/signed OR dead OR the event does not appear to exist (hallucination) OR wrong location for the tagged state OR it is framed around a specific named politician/party; " +
  "unsure = not enough evidence. When unsure, say so (a human will review). " +
  'Reply with ONLY a JSON object: {"disposition":"approve|reject|unsure","confidence":0..1,"reason":"<=180 chars citing what the search showed"}.';

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
): Promise<FactVerdict> {
  const prompt: PromptInput = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content:
        `TYPE: ${kind}\nHEADLINE: ${title}\nTAGGED LOCATION: ${state || "FED/national"}\n` +
        `TODAY: ${new Date().toISOString().slice(0, 10)}\nSearch the web, then reply with the JSON verdict only.`,
    },
  ];
  try {
    const { text } = await complete(
      "general",
      prompt,
      { needsGrounding: true },
      { temperature: 0, maxTokens: 500, extra: { tools: [{ google_search: {} }] } },
    );
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
