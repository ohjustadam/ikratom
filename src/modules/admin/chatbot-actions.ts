"use server";

/**
 * Admin-only RAG chatbot.
 *
 * Owner directive 2026-05-15: "begin on admin only rag chatbot."
 *
 * Retrieval-Augmented Generation against the iKratom corpus:
 *   1. Reuse src/lib/site-search to retrieve up to 20 relevant items
 *      (bills, papers, campaigns, etc.) for the user's question.
 *   2. Inline the top hits' title + snippet into the LLM prompt as
 *      structured context blocks with stable [src:n] citation tags.
 *   3. Ask the AI router (Groq → Gemini → Ollama, all free tier) to
 *      answer ONLY from the provided context, citing [src:n] inline.
 *   4. Return the answer + the source list so the UI can render
 *      clickable citations.
 *
 * Why admin-only first: token costs are still real on the free tier
 * (quota limits). Opening to all signed-in users would need a stricter
 * per-user cap + Cloudflare WAF in front. Admins are <10 humans on
 * this platform, so the volume is naturally bounded.
 *
 * Rate-limit: 30 messages/hour per admin user. Plenty for normal
 * exploration, low enough that an accidental loop won't burn the quota.
 */

import { getAdminContext } from "@/modules/admin/actions";
import { checkRateLimit } from "@/lib/rate-limit";
import { complete } from "@/lib/ai/router";
import { searchSite, type SiteSearchHit } from "@/lib/site-search";

const MAX_QUESTION_LEN = 500;
const MAX_HISTORY_TURNS = 6;
const TOP_K = 12;

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatSource = {
  n: number;
  kind: SiteSearchHit["kind"];
  title: string;
  href: string;
};

export type ChatAnswer =
  | { ok: true; answer: string; sources: ChatSource[]; provider: string }
  | { ok: false; error: string };

/**
 * Ask the admin chatbot. `history` is the prior turns from THIS session
 * — keeps the server stateless. Client owns conversation state.
 */
export async function askAdminChatbot(
  question: string,
  history: ChatTurn[],
): Promise<ChatAnswer> {
  const ctx = await getAdminContext({ require: "use_ai_editor" });
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  const q = question.trim().slice(0, MAX_QUESTION_LEN);
  if (q.length < 3) return { ok: false, error: "Question too short — needs at least 3 characters." };

  // Per-admin rate limit. 30 messages/hour is enough for genuine work,
  // narrow enough that a runaway loop won't burn the quota.
  const allowed = await checkRateLimit(`adminChat:${ctx.userId}`, 30, 60 * 60);
  if (!allowed) {
    return { ok: false, error: "Rate limit reached (30 msgs / hour). Wait a few minutes." };
  }

  // Retrieve. We use the same engine that powers /search — keeps the
  // retrieval pure-Postgres + already RLS-aware + already rate-limited
  // internally for the underlying queries.
  let hits: SiteSearchHit[] = [];
  try {
    const r = await searchSite(q, {});
    hits = r.hits.slice(0, TOP_K);
  } catch (e) {
    // Retrieval failure is non-fatal — we fall through to "no context"
    // mode where the LLM answers from its own knowledge but flagged.
    console.error("[admin-chat] retrieval failed:", e);
  }

  const sources: ChatSource[] = hits.map((h, i) => ({
    n: i + 1,
    kind: h.kind,
    title: h.title,
    href: h.href,
  }));

  const contextBlock = hits.length === 0
    ? "(No matching documents in the iKratom corpus. Answer from general knowledge and flag the gap.)"
    : hits.map((h, i) =>
        `[src:${i + 1}] ${h.kind.toUpperCase()} — ${h.title}\n${h.subtitle ?? ""}\n${(h.snippet ?? "").slice(0, 400)}`
      ).join("\n\n---\n\n");

  const recentHistory = history.slice(-MAX_HISTORY_TURNS).map((t) => ({
    role: t.role,
    content: t.content.slice(0, 2000),
  }));

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: [
        "You are the iKratom Admin Assistant — a retrieval-augmented chatbot used by site admins to explore the kratom advocacy corpus.",
        "Ground every claim in the provided CONTEXT block. Cite sources inline with [src:N] tags matching the numbered context. If the context doesn't contain the answer, say so explicitly — do NOT invent facts about kratom legislation, research, or legislators.",
        "Be concise. Single answer per turn. Markdown OK for lists and emphasis.",
        "If the user asks something off-topic from kratom advocacy, politely redirect.",
        "",
        "CONTEXT:",
        contextBlock,
      ].join("\n"),
    },
    ...recentHistory,
    { role: "user", content: q },
  ];

  let result;
  try {
    result = await complete(
      "reasoning", // routes to Groq GPT-OSS-120B for best chain-of-thought at $0
      messages,
      {},
      { maxTokens: 800, temperature: 0.2 },
    );
  } catch (e) {
    return { ok: false, error: `AI router failed: ${(e as Error).message}` };
  }

  return {
    ok: true,
    answer: result.text.trim(),
    sources,
    provider: result.provider,
  };
}
