/**
 * AI-summarize a phone-call transcript.
 *
 * Produces THREE things from one model call:
 *   1. summary_md      — full summary INCLUDING verbatim key quotes. PRIVATE:
 *                        shown to the caller + the admin moderation view only.
 *   2. public_summary_md — a QUOTE-FREE, PII-light summary safe to publish on
 *                        the /calls/board intel surface (position + concerns +
 *                        follow-up, no verbatim quotes of the official).
 *   3. legislator_position — the stated position as a queryable enum, so the
 *                        board can roll up "what is government saying" by state.
 *
 * Groq only, JSON mode: a transcript is a member's own record of a call, so it
 * never goes to Gemini (owner, 2026-11-26). Two Groq models stand in for each
 * other, because each has its own daily allowance.
 *
 * A plain server-only module, NOT "use server": it is called only from
 * actions.ts, and as a server action every export would be an endpoint
 * anyone could call to spend our AI quotas. Returns nulls on total provider failure;
 * calls never block on summary generation, and the raw transcript stays.
 */

import "server-only";
import {
  formatSummaryMd,
  formatPublicSummaryMd,
  normalizePosition,
  type Position,
  type SummaryParsed,
} from "./summary-format";

const GROQ_KEY = process.env.GROQ_API_KEY;
// The members' model first: the background jobs spend gpt-oss-120b's day.
const MODELS = [process.env.GROQ_MODEL_MEMBER ?? "openai/gpt-oss-20b", "openai/gpt-oss-120b"];

const SYSTEM = `You summarize a single phone call between a kratom advocate and a US legislator (or their staff).
The transcript is rough — speech recognition introduces typos, dropped words, speaker switches mid-sentence.
Be charitable in interpretation.

Return JSON with these fields:

{
  "summary_md": "3-5 sentence factual summary of what was discussed. Markdown bullet structure if useful.
                 Be specific: name the bill/topic, the legislator's stated position (if they shared one),
                 and the call outcome (committed / declined / will-think / unclear).
                 ALWAYS distinguish natural-leaf kratom from 7-OH-enriched / synthetic products if
                 that distinction came up.
                 PARAPHRASE ONLY — do NOT put any direct quotation or quoted phrase in summary_md;
                 ALL verbatim wording goes in key_quotes (it is shown only privately).",
  "legislator_position": "supportive" | "opposed" | "undecided" | "unclear" | "not_discussed",
  "key_quotes": ["array of 0-3 short direct quotes (under 25 words each) that capture the legislator's
                  voice on kratom. Use exact wording from the transcript. Empty array if no notable quotes."],
  "follow_up_needed": "1-2 sentence advice for the advocate on next step. Empty string if no follow-up needed.",
  "concerns_raised_by_legislator": ["array of 0-5 specific concerns the legislator raised (safety, youth access,
                                     addiction, etc.). Empty array if none."]
}

Return ONLY the JSON. No prose around it.`;

async function callGroq(transcript: string, ctx: string, model: string): Promise<{ parsed: SummaryParsed; provider: string } | null> {
  if (!GROQ_KEY) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${ctx}\n\nTRANSCRIPT:\n${transcript}` },
        ],
        temperature: 0.2,
        // gpt-oss thinks first and those tokens count against max_tokens.
        max_tokens: 1_500,
        ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    return { parsed: JSON.parse(raw) as SummaryParsed, provider: "groq" };
  } catch {
    return null;
  }
}

export async function aiSummarizeCall(args: {
  transcript_md: string;
  recipient_name: string | null;
  recipient_role: string | null;
  state: string | null;
}): Promise<{
  summary_md: string | null;
  public_summary_md: string | null;
  legislator_position: Position | null;
  provider: string | null;
}> {
  const ctx =
    `CALL CONTEXT:\n` +
    `Recipient: ${args.recipient_name ?? "(unknown)"}\n` +
    `Role: ${args.recipient_role ?? "(unknown)"}\n` +
    `State: ${args.state ?? "(unknown)"}\n`;

  for (const model of MODELS) {
    const r = await callGroq(args.transcript_md, ctx, model);
    if (r) {
      return {
        summary_md: formatSummaryMd(r.parsed),
        public_summary_md: formatPublicSummaryMd(r.parsed),
        legislator_position: normalizePosition(r.parsed.legislator_position),
        provider: r.provider,
      };
    }
  }
  return { summary_md: null, public_summary_md: null, legislator_position: null, provider: null };
}
