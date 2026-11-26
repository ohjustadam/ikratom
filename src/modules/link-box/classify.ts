import "server-only";

import { completeStructured } from "@/lib/ai/router";
import type { StructuredSchema } from "@/lib/ai/types";
import { INTEL_KINDS, looksKratomRelated, normalizeReading, type LinkReading } from "@/lib/link-box";

/**
 * Read one new link with the FREE router (Groq, then Gemini; never a paid
 * model, CLAUDE.md). Strictly bounded: 8 seconds, then a plain keyword
 * fallback, so a slow provider never leaves a member staring at "Checking…".
 * The reading only fills in the tip for a moderator, who makes every call.
 */
const SYSTEM =
  "You read ONE news link for iKratom, a strictly NONPARTISAN kratom-advocacy site. " +
  "Use only the headline, description and address given. Do not guess beyond them. " +
  "kratom: true only if it is about kratom, mitragynine or 7-OH (7-hydroxymitragynine): law, policy, enforcement, health or business. " +
  "kind: bill_event (a bill or a city/county ordinance), bop_hearing (state pharmacy board), fda_action, dea_action, " +
  "ag_enforcement (attorney general, police or prosecutors), news_break (anything else). " +
  "severity: critical only for a vote, hearing or deadline in the next 14 days; alert for an active situation; watch otherwise. " +
  "locality: the 2-letter code of the US state the story is about, FED for US federal action, or empty. " +
  "action_needed: true only when there is a pending vote, hearing, comment period or bill that people can still influence. " +
  "summary: two plain, neutral sentences on what happened. No opinions, no praise or blame of any politician or party, " +
  "no names of private people. Reply with the JSON object only.";

const SCHEMA: StructuredSchema = {
  type: "object",
  properties: {
    kratom: { type: "boolean" },
    kind: { type: "string", enum: [...INTEL_KINDS] },
    severity: { type: "string", enum: ["watch", "alert", "critical"] },
    locality: { type: "string" },
    action_needed: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["kratom", "kind", "severity", "locality", "action_needed", "summary"],
};

const TIMEOUT_MS = 8_000;

export async function readLink(input: { url: string; title: string | null; description: string | null; siteName: string | null }): Promise<LinkReading> {
  const text = [input.title, input.description].filter(Boolean).join(" ");
  const fallback = {
    kratom: looksKratomRelated(`${text} ${input.url}`),
    summary: (input.description || input.title || "A member shared this link.").slice(0, 600),
  };
  const user =
    `HEADLINE: ${(input.title ?? "(none)").slice(0, 300)}\n` +
    `DESCRIPTION: ${(input.description ?? "(none)").slice(0, 900)}\n` +
    `SITE: ${(input.siteName ?? "").slice(0, 80)}\nADDRESS: ${input.url.slice(0, 300)}\n` +
    `TODAY: ${new Date().toISOString().slice(0, 10)}`;
  try {
    const call = completeStructured<Record<string, unknown>>(
      "link_classify",
      [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      SCHEMA,
      {},
      { temperature: 0, maxTokens: 400 },
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const r = await Promise.race([call.catch(() => null), timeout]);
    const reading = normalizeReading(r?.data ?? null, fallback);
    // The keyword test is a floor, never a veto: "kratom" in the headline is about kratom.
    return fallback.kratom ? { ...reading, kratom: true } : reading;
  } catch {
    return normalizeReading(null, fallback);
  }
}
