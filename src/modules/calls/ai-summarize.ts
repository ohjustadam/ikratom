"use server";

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
 * Uses the same multi-provider chain as the briefing generator —
 * Groq/Cerebras/Gemini, JSON mode. Returns nulls on total provider failure;
 * calls never block on summary generation, and the raw transcript stays.
 */

import {
  formatSummaryMd,
  formatPublicSummaryMd,
  normalizePosition,
  type Position,
  type SummaryParsed,
} from "./summary-format";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

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

async function callGroq(transcript: string, ctx: string): Promise<{ parsed: SummaryParsed; provider: string } | null> {
  if (!GROQ_KEY) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${ctx}\n\nTRANSCRIPT:\n${transcript}` },
        ],
        temperature: 0.2,
        max_tokens: 800,
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

async function callGemini(transcript: string, ctx: string): Promise<{ parsed: SummaryParsed; provider: string } | null> {
  if (!GEMINI_KEY) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${ctx}\n\nTRANSCRIPT:\n${transcript}` }] }],
          systemInstruction: { parts: [{ text: SYSTEM }] },
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    return { parsed: JSON.parse(raw) as SummaryParsed, provider: "gemini" };
  } catch {
    return null;
  }
}

async function callCerebras(transcript: string, ctx: string): Promise<{ parsed: SummaryParsed; provider: string } | null> {
  if (!CEREBRAS_KEY) return null;
  try {
    const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${ctx}\n\nTRANSCRIPT:\n${transcript}` },
        ],
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    return { parsed: JSON.parse(raw) as SummaryParsed, provider: "cerebras" };
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

  const providers: Array<() => Promise<{ parsed: SummaryParsed; provider: string } | null>> = [
    () => callGroq(args.transcript_md, ctx),
    () => callCerebras(args.transcript_md, ctx),
    () => callGemini(args.transcript_md, ctx),
  ];
  for (const fn of providers) {
    const r = await fn();
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

// Cloudflare/Anthropic/Mistral references appear for future expansion
void ANTHROPIC_KEY; void MISTRAL_KEY; void CLOUDFLARE_AI_TOKEN; void CLOUDFLARE_ACCOUNT_ID;
