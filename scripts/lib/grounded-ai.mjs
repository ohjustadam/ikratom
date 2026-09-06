/**
 * grounded-ai.mjs — one grounded-generation call with an automatic ungrounded
 * fallback, so a single provider outage can no longer silence a pipeline.
 *
 * WHY THIS EXISTS (2026-09-05/06). Several scripts need Gemini specifically,
 * because they use its `google_search` tool to corroborate a claim against the
 * live web — something the shared free router cannot do. So they called Gemini
 * DIRECTLY and had no fallback at all. When the key began answering
 * 429 "prepayment credits are depleted", every one of them failed on every run
 * and kept failing silently:
 *
 *   classify_bop_findings_ai      "0 classified · 20 failed", days on end
 *   discover_municipal_meetings   "51 states · 0 found · 0 new", 4 days straight
 *
 * The insight that makes the fallback safe: **grounding is an enhancement, not
 * a precondition.** These prompts already carry the source text (a finding, a
 * PDF extract, an agenda). Search only adds outside corroboration. An
 * ungrounded answer at lower confidence is far more useful than no answer for
 * days — and every consumer of these scripts already routes low confidence to
 * human review.
 *
 * Callers get `grounded: false` back so they can record WHY a row is less
 * certain, rather than silently mixing the two.
 *
 * ⚠ THE FALLBACK IS OPT-IN, AND THAT IS DELIBERATE. It is only safe when the
 * material being judged is ALREADY IN THE PROMPT — classifying a finding,
 * summarising an extract. It is NOT safe for DISCOVERY, where the model is
 * asked to find facts on the open web: without search, an obliging model
 * invents them. discover-municipal-meetings literally instructs "only include
 * meetings you have concrete evidence for from grounded search" — degrading
 * that to a guess would manufacture municipal meetings, which is the same
 * failure class as the false 7-OH scheduling alert. Discovery callers pass
 * allowUngrounded:false and fail loudly instead.
 *
 * See also lib/ai-router.mjs (the free-provider rotation) and memory
 * "free-ai-router-provider-churn" for the provider-retirement history.
 */
import { aiRouter, listAvailableProviders } from "./ai-router.mjs";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Extract the first JSON object/array from a model response. Models wrap JSON
 * in prose or ```json fences no matter how firmly you ask them not to, and each
 * caller had reinvented this slightly differently.
 */
export function extractJson(text) {
  if (!text) return null;
  const stripped = String(text).replace(/```(?:json)?/gi, "").trim();
  // Prefer an explicit <result> block when the prompt asked for one.
  const tagged = stripped.match(/<result>([\s\S]*?)<\/result>/);
  const body = tagged ? tagged[1].trim() : stripped;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/**
 * Generate with Google-Search grounding, falling back to the free router.
 *
 * @param {object}  o
 * @param {string}  o.system         system instruction
 * @param {string}  o.user           user prompt
 * @param {number} [o.maxTokens]
 * @param {string} [o.model]         Gemini model (default gemini-2.5-flash)
 * @param {boolean}[o.json]          parse the reply as JSON (default true)
 * @returns {Promise<{ text: string, parsed: any, grounded: boolean, provider: string }>}
 */
export async function groundedGenerate({
  system,
  user,
  maxTokens = 1024,
  model = "gemini-2.5-flash",
  json = true,
  timeoutMs = 60_000,
  // Opt-in. false = grounding is REQUIRED; throw rather than guess.
  allowUngrounded = true,
}) {
  const key = process.env.GEMINI_API_KEY;

  if (key) {
    try {
      const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: user }] }],
          systemInstruction: { parts: [{ text: system }] },
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? "").join("");
        if (text.trim()) {
          return { text, parsed: json ? extractJson(text) : null, grounded: true, provider: "gemini" };
        }
      } else {
        const body = (await res.text()).slice(0, 160);
        console.log(`  ↻ Gemini ${res.status} — falling back to the router (ungrounded): ${body.slice(0, 90)}`);
      }
    } catch (e) {
      console.log(`  ↻ Gemini unreachable — falling back to the router (ungrounded): ${String(e.message ?? e).slice(0, 70)}`);
    }
  }

  if (!allowUngrounded) {
    // Discovery work: no search means no evidence, and no evidence means we do
    // not answer. The caller surfaces this in telemetry so a depleted key reads
    // as "grounding unavailable", never as "nothing found".
    throw new Error("GROUNDING_UNAVAILABLE: search-grounded generation required but Gemini is not answering");
  }
  if (listAvailableProviders().length === 0) {
    throw new Error("No grounded provider and no router providers configured");
  }

  const r = await aiRouter({
    systemPrompt:
      `${system}\n\nIMPORTANT: you do NOT have web search on this call. Judge only ` +
      `from the text provided. Do not invent sources, dates, names or URLs, and ` +
      `lower your confidence to reflect the missing corroboration.` +
      (json ? `\n\nReturn ONLY JSON.` : ""),
    userPrompt: user,
    maxTokens,
    verbose: false,
  });
  const text = typeof r.parsed === "string" ? r.parsed : JSON.stringify(r.parsed ?? "");
  return { text, parsed: r.parsed ?? null, grounded: false, provider: r.provider };
}
