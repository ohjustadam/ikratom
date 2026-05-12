"use server";

/**
 * AI-summarize a phone-call transcript.
 *
 * The output feeds two purposes:
 *   1. Helps the calling advocate remember what was actually said.
 *   2. (When admin-approved + public) aggregates into "what is government
 *      saying about kratom" intel across all submitted calls.
 *
 * Uses the same multi-provider AI router as the briefing generator —
 * Gemini/Groq/Cerebras/Mistral/Cloudflare/Ollama fallback chain. JSON
 * mode for reliable schema.
 *
 * Returns null on any provider failure — calls should never block on
 * summary generation, and the raw transcript stays available.
 */

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
                 that distinction came up.",
  "legislator_position": "supportive" | "opposed" | "undecided" | "unclear" | "not_discussed",
  "key_quotes": ["array of 0-3 short direct quotes (under 25 words each) that capture the legislator's
                  voice on kratom. Use exact wording from the transcript. Empty array if no notable quotes."],
  "follow_up_needed": "1-2 sentence advice for the advocate on next step. Empty string if no follow-up needed.",
  "concerns_raised_by_legislator": ["array of 0-5 specific concerns the legislator raised (safety, youth access,
                                     addiction, etc.). Empty array if none."]
}

Return ONLY the JSON. No prose around it.`;

async function callGroq(transcript: string, ctx: string): Promise<{ summary_md: string; provider: string } | null> {
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
    const parsed = JSON.parse(raw);
    const md = formatSummaryMd(parsed);
    return { summary_md: md, provider: "groq" };
  } catch {
    return null;
  }
}

async function callGemini(transcript: string, ctx: string): Promise<{ summary_md: string; provider: string } | null> {
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
    const parsed = JSON.parse(raw);
    const md = formatSummaryMd(parsed);
    return { summary_md: md, provider: "gemini" };
  } catch {
    return null;
  }
}

async function callCerebras(transcript: string, ctx: string): Promise<{ summary_md: string; provider: string } | null> {
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
    const parsed = JSON.parse(raw);
    const md = formatSummaryMd(parsed);
    return { summary_md: md, provider: "cerebras" };
  } catch {
    return null;
  }
}

function formatSummaryMd(parsed: {
  summary_md?: string;
  legislator_position?: string;
  key_quotes?: string[];
  follow_up_needed?: string;
  concerns_raised_by_legislator?: string[];
}): string {
  const blocks: string[] = [];
  if (parsed.summary_md) blocks.push(parsed.summary_md);
  if (parsed.legislator_position) {
    blocks.push(`**Stated position:** ${parsed.legislator_position}`);
  }
  if (parsed.key_quotes && parsed.key_quotes.length > 0) {
    blocks.push(`**Key quotes:**\n${parsed.key_quotes.map((q: string) => `> "${q}"`).join("\n\n")}`);
  }
  if (parsed.concerns_raised_by_legislator && parsed.concerns_raised_by_legislator.length > 0) {
    blocks.push(`**Concerns raised:** ${parsed.concerns_raised_by_legislator.join(" · ")}`);
  }
  if (parsed.follow_up_needed) {
    blocks.push(`**Follow-up:** ${parsed.follow_up_needed}`);
  }
  return blocks.join("\n\n");
}

export async function aiSummarizeCall(args: {
  transcript_md: string;
  recipient_name: string | null;
  recipient_role: string | null;
  state: string | null;
}): Promise<{ summary_md: string | null; provider: string | null }> {
  const ctx =
    `CALL CONTEXT:\n` +
    `Recipient: ${args.recipient_name ?? "(unknown)"}\n` +
    `Role: ${args.recipient_role ?? "(unknown)"}\n` +
    `State: ${args.state ?? "(unknown)"}\n`;

  // Provider rotation — try fast/cheap first
  const providers: Array<() => Promise<{ summary_md: string; provider: string } | null>> = [
    () => callGroq(args.transcript_md, ctx),
    () => callCerebras(args.transcript_md, ctx),
    () => callGemini(args.transcript_md, ctx),
  ];
  for (const fn of providers) {
    const r = await fn();
    if (r) return r;
  }
  return { summary_md: null, provider: null };
}

// Cloudflare/Anthropic/Mistral references appear for future expansion
void ANTHROPIC_KEY; void MISTRAL_KEY; void CLOUDFLARE_AI_TOKEN; void CLOUDFLARE_ACCOUNT_ID;
