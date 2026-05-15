"use server";

/**
 * Free abstract / metadata auto-fill for research papers.
 *
 * Owner directive 2026-05-15: "manual abstract editing: why do we need
 * to do this with paid? can none of our existing tools do there?"
 *
 * Answer: yes. Our existing AI router (Gemini Flash 2.5 + Groq Llama 3.3
 * + Ollama) has free-tier access. This action:
 *
 *   1. Verifies admin auth
 *   2. Refuses if the paper already has a non-trivial abstract
 *      (preserve original-abstract guarantee — see /research page copy)
 *   3. Fetches full_text_url, strips HTML noise
 *   4. Asks the AI router to extract just the abstract from the page
 *      content (or, if not present, write a brief 2-3 sentence summary
 *      flagged as ai_summary not original)
 *   5. Writes to research_papers.abstract, appends a provenance line to
 *      admin_notes_md, records audit
 *
 * Provider preference: Groq first (fastest free tier), Gemini second
 * (grounding-capable; works for paywalled abstracts that we hit via
 * the publisher's preview), Ollama last (local; works offline but
 * slower).
 *
 * Never overrides an existing curated abstract — admin must clear it
 * first if they want to re-fill. This protects the "original abstract,
 * verbatim" promise to readers.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { complete } from "@/lib/ai/router";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type AutofillResult =
  | { ok: true; abstract: string; provider: string; chars: number }
  | { ok: false; error: string };

const MIN_FETCH_BYTES = 500;
const MAX_FETCH_BYTES = 200_000;
const MAX_ABSTRACT_LEN = 4000;

export async function autofillResearchPaperAbstract(paperId: string): Promise<AutofillResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const db = admin();
  const { data: paper, error: fetchErr } = await db
    .from("research_papers")
    .select("id, title, abstract, full_text_url, pdf_url, admin_notes_md")
    .eq("id", paperId)
    .maybeSingle();
  if (fetchErr || !paper) return { ok: false, error: "Paper not found." };

  // Refuse to overwrite a non-trivial existing abstract — original is sacred.
  const existing = (paper.abstract ?? "").trim();
  if (existing.length > 200) {
    return {
      ok: false,
      error: `Paper already has a ${existing.length}-char abstract. Clear it manually first if you want to refill (the original abstract is preserved by policy).`,
    };
  }

  const url = paper.full_text_url ?? paper.pdf_url;
  if (!url) return { ok: false, error: "Paper has no URL to fetch from." };

  // Fetch the page server-side. We can hit paywalled sites that browsers
  // can't reach because we're not subject to their referrer/cookie policies.
  let pageText: string;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "iKratom Research Bot (research@ikratom.org)" },
    });
    if (!r.ok) return { ok: false, error: `Source URL returned HTTP ${r.status}.` };
    const html = await r.text();
    if (html.length < MIN_FETCH_BYTES) {
      return { ok: false, error: `Source URL returned only ${html.length} bytes — likely a JS-rendered SPA we can't read.` };
    }
    pageText = stripHtmlToText(html).slice(0, MAX_FETCH_BYTES);
  } catch (e) {
    return { ok: false, error: `Couldn't fetch source: ${(e as Error).message}` };
  }

  // Ask the AI to extract / summarize. Prefer the actual abstract verbatim
  // when present; only summarize if the page truly doesn't contain one.
  const prompt = [
    {
      role: "system" as const,
      content: `You extract research-paper abstracts from raw page text. Output ONLY the abstract — no preamble, no headings, no markdown. If the page contains an actual abstract section, return it VERBATIM (it's the original-content guarantee). If the page has no abstract but does contain methods/results/conclusions, write a 2-3 sentence neutral summary; prefix it with "[AI summary, no abstract on source page]:". If you can't find either, respond exactly with: NO_ABSTRACT_FOUND.`,
    },
    {
      role: "user" as const,
      content: `Title: ${paper.title}\nURL: ${url}\n\nPage text (truncated):\n\n${pageText}`,
    },
  ];

  let result;
  try {
    result = await complete("news_enrich", prompt, { preferSpeed: true }, { maxTokens: 1500, temperature: 0.1 });
  } catch (e) {
    return { ok: false, error: `AI router failed: ${(e as Error).message}` };
  }

  const extracted = result.text.trim().slice(0, MAX_ABSTRACT_LEN);
  if (extracted === "NO_ABSTRACT_FOUND" || extracted.length < 50) {
    return { ok: false, error: "AI couldn't locate or summarize an abstract on the source page." };
  }

  // Write back. Append a provenance line to admin_notes_md so future
  // editors can see this abstract was AI-extracted, not human-curated.
  const provenance = `AI-extracted abstract via ${result.provider} on ${new Date().toISOString().slice(0, 10)} by ${ctx.email ?? ctx.userId}`;
  const newNotes = paper.admin_notes_md ? `${paper.admin_notes_md}\n\n${provenance}` : provenance;

  const { error: updErr } = await db
    .from("research_papers")
    .update({ abstract: extracted, admin_notes_md: newNotes })
    .eq("id", paperId);
  if (updErr) return { ok: false, error: `Couldn't save: ${updErr.message}` };

  try {
    await recordAdminAction({
      action: "research.abstract_autofill",
      details: { paper_id: paperId, provider: result.provider, chars: extracted.length },
    });
  } catch { /* non-fatal */ }

  return { ok: true, abstract: extracted, provider: result.provider, chars: extracted.length };
}

/**
 * Strip HTML to plain readable text. Server-side only — we use this
 * before sending the page content to the AI router, which has no need
 * for nav/footer/script noise.
 */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
