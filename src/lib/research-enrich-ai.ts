/**
 * AI-powered abstract extractor — used at submit time to fill in
 * abstracts when the regex-based meta-tag extractor only catches a
 * truncated og:description.
 *
 * Owner directive 2026-05-16: the test paper got 316 chars of
 * truncated abstract while the actual abstract on the RSC source page
 * was visible + several thousand chars long. We need autonomous
 * enrichment so the kratom RAG / cross-correlation brain has real
 * content to ground on, not OG snippets.
 *
 * Routes through the existing AI router (Groq → Gemini → Ollama, all
 * free tier). Doesn't write to the DB — just returns the extracted
 * abstract string. Caller decides what to do (write to research_papers,
 * tag provenance in admin_notes, etc.).
 */

import { complete } from "@/lib/ai/router";
import { stripHtmlToText } from "@/lib/research-metadata";

const MAX_INPUT_CHARS = 200_000;   // hard cap on what we send to the model
const MIN_FETCH_BYTES = 500;
const MAX_ABSTRACT_OUTPUT = 6000;
const FETCH_TIMEOUT_MS = 20_000;

export type EnrichResult =
  | { ok: true; abstract: string; provider: string; chars: number }
  | { ok: false; error: string };

/**
 * Fetch a research-paper URL + ask the AI to extract the abstract.
 * Returns the abstract as a string. Caller persists.
 */
export async function enrichAbstractFromUrl(input: {
  url: string;
  title: string | null;
}): Promise<EnrichResult> {
  let html: string;
  try {
    const r = await fetch(input.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "iKratom Research Bot (research@ikratom.org)" },
    });
    if (!r.ok) return { ok: false, error: `Source URL returned HTTP ${r.status}.` };
    html = await r.text();
    if (html.length < MIN_FETCH_BYTES) {
      return { ok: false, error: `Source returned only ${html.length} bytes — likely a JS-rendered SPA we can't read.` };
    }
  } catch (e) {
    return { ok: false, error: `Couldn't fetch source: ${(e as Error).message}` };
  }

  const pageText = stripHtmlToText(html).slice(0, MAX_INPUT_CHARS);

  const prompt = [
    {
      role: "system" as const,
      content: [
        "You extract research-paper abstracts from raw page text.",
        "Output ONLY the abstract — no preamble, no 'Here is the abstract', no headings, no markdown formatting.",
        "If the page contains an actual abstract section, return it VERBATIM. Do not paraphrase, summarize, or condense it. The verbatim original is the source-of-truth that downstream RAG / cross-correlation depends on.",
        "If the page has no explicit abstract but contains methods/results/conclusions, write a faithful 2-3 sentence neutral summary; prefix it with '[AI summary, no abstract on source page]:'.",
        "If you can't find an abstract or summarize-able content, respond exactly with: NO_ABSTRACT_FOUND.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `Title: ${input.title ?? "(unknown)"}\nURL: ${input.url}\n\nPage text (truncated to ${MAX_INPUT_CHARS} chars):\n\n${pageText}`,
    },
  ];

  let result;
  try {
    result = await complete(
      "news_enrich",
      prompt,
      { preferSpeed: true },
      { maxTokens: 2000, temperature: 0.1 },
    );
  } catch (e) {
    return { ok: false, error: `AI router failed: ${(e as Error).message}` };
  }

  const extracted = result.text.trim().slice(0, MAX_ABSTRACT_OUTPUT);
  if (extracted === "NO_ABSTRACT_FOUND" || extracted.length < 80) {
    return { ok: false, error: "AI couldn't locate or summarize an abstract on the source page." };
  }

  return {
    ok: true,
    abstract: extracted,
    provider: result.provider,
    chars: extracted.length,
  };
}
