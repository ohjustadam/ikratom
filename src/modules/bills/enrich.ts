import type { SupabaseClient } from "@supabase/supabase-js";
import { runAiStructured } from "@/lib/ai/jobs";
import type { StructuredSchema } from "@/lib/ai/types";

/**
 * Server-side bill enrichment via the AI router.
 *
 * Ports the logic from scripts/enrich-bills.mjs to a TS module that
 * runs in cron context. The script remains intact for local
 * llama3.3:70b runs that benefit from the larger model; this module is
 * the cloud version that ships in Vercel and falls back through the
 * router (Ollama → Groq → Gemini) so cron always has a working AI even
 * when the owner's local Ollama isn't reachable.
 *
 * Why both:
 *   - Local script: runs llama3.3:70b for highest-quality batch passes
 *   - This module: runs in 60s cron via Groq (~2s/bill, free), keeps
 *     newly-arrived bills enriched within 24h of detection
 *
 * Side effect: every call logs to `ai_jobs` via runAiStructured(), so
 * the AI Command Center fills with real production activity.
 */

type BillRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary: string | null;
  last_action: string | null;
};

type EnrichOutput = {
  summary_ai: string;
  advocacy_callout: string;
  stance: "pro" | "anti" | "neutral";
  confidence: number;
};

const SCHEMA: StructuredSchema = {
  type: "object",
  properties: {
    summary_ai: { type: "string", description: "Exactly 2 short sentences in plain English describing what this bill does." },
    advocacy_callout: { type: "string", description: "Exactly 1 sentence on why kratom advocates should care." },
    stance: { type: "string", enum: ["pro", "anti", "neutral"], description: "Position relative to natural-leaf kratom." },
    confidence: { type: "number", description: "0.00 to 1.00 confidence in the stance classification." },
  },
  required: ["summary_ai", "advocacy_callout", "stance", "confidence"],
};

const SYSTEM = `You analyze U.S. state and federal legislation about kratom for a nonpartisan civic-action platform.

You receive a bill's number, title, official summary/abstract, and last action. You return a strict JSON object with these fields:

1. summary_ai — exactly 2 short sentences in plain English. What does this bill DO? Don't invent details beyond the inputs.

2. advocacy_callout — exactly 1 sentence. What should kratom advocates DO about this bill? Examples:
   - "This bill would ban kratom retail sales statewide — advocates should oppose."
   - "This bill regulates 7-OH but explicitly preserves traditional kratom — advocates can support."
   - "This bill is procedural; no immediate impact on kratom availability."

3. stance — exactly one of "pro" | "anti" | "neutral":
   - pro: protects, regulates reasonably, or otherwise benefits the kratom community
   - anti: bans, restricts harmfully, criminalizes, or otherwise harms the kratom community
   - neutral: procedural, study-only, or genuinely mixed

4. confidence — number 0.00 to 1.00. Use < 0.6 if you're guessing.

The "natural leaf vs synthetic 7-OH-enhanced" distinction matters. A bill that ONLY restricts synthetic high-alkaloid concentrates while preserving plain leaf availability is NOT anti for our purposes — it's typically neutral or pro.

Return ONLY the JSON object. No prose around it.`;

const MIN_RELEVANCE_CONFIDENCE = 0.6;
const PER_CRON_LIMIT = 30; // stays well under Vercel function 60-300s budget

/**
 * Enrich a single bill. Idempotent — caller decides whether to skip
 * already-enriched bills.
 */
export async function enrichBillShallow(
  supabase: SupabaseClient,
  bill: BillRow,
): Promise<{ ok: true; relevance: string; confidence: number } | { error: string }> {
  const userPrompt = [
    `Bill number: ${bill.bill_number}`,
    `State: ${bill.state}`,
    `Title: ${bill.title ?? "(none)"}`,
    `Summary: ${bill.summary ?? "(none)"}`,
    `Last action: ${bill.last_action ?? "(none)"}`,
  ].join("\n");

  let result;
  try {
    result = await runAiStructured<EnrichOutput>(
      "bill_summary",
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      SCHEMA,
      { caller: "cron:enrich-bills", metadata: { bill_id: bill.id } },
      {}, // default routing — ollama → groq → gemini
      { temperature: 0.1, maxTokens: 600 },
    );
  } catch (e) {
    return { error: (e as Error).message };
  }

  const out = result.data;
  // Sanity: clamp + validate stance + confidence
  const stance = ["pro", "anti", "neutral"].includes(out.stance) ? out.stance : "neutral";
  const confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));

  // Only update kratom_relevance when we're confident; otherwise keep
  // whatever the keyword classifier put there.
  const update: Record<string, unknown> = {
    summary_ai: out.summary_ai?.slice(0, 1000) ?? null,
    advocacy_callout: out.advocacy_callout?.slice(0, 500) ?? null,
    relevance_confidence: confidence,
    enriched_at: new Date().toISOString(),
  };
  if (confidence >= MIN_RELEVANCE_CONFIDENCE) {
    update.kratom_relevance = stance;
  }

  const { error } = await supabase.from("bills").update(update).eq("id", bill.id);
  if (error) return { error: error.message };
  return { ok: true, relevance: stance, confidence };
}

/**
 * Cron entry point — picks up un-enriched bills (or stale ones if
 * `refresh=true`) and runs them through the router. Capped at
 * PER_CRON_LIMIT to stay within Vercel's function duration budget.
 *
 * Returns aggregate result for the cron's log.
 */
export async function enrichRecentlyAddedBills(
  supabase: SupabaseClient,
  opts: { limit?: number; refresh?: boolean } = {},
): Promise<{ considered: number; enriched: number; failed: number; errors: { bill_id: string; reason: string }[] }> {
  const limit = Math.min(opts.limit ?? PER_CRON_LIMIT, PER_CRON_LIMIT);

  let query = supabase
    .from("bills")
    .select("id, state, bill_number, title, summary, last_action, summary_ai, enriched_at")
    .eq("active", true)
    .order("last_synced_at", { ascending: false })
    .limit(limit);
  if (!opts.refresh) {
    query = query.is("summary_ai", null);
  }

  const { data: bills, error } = await query;
  if (error) {
    return { considered: 0, enriched: 0, failed: 0, errors: [{ bill_id: "(query)", reason: error.message }] };
  }

  const result = { considered: bills?.length ?? 0, enriched: 0, failed: 0, errors: [] as { bill_id: string; reason: string }[] };
  if (!bills || bills.length === 0) return result;

  for (const b of bills) {
    const r = await enrichBillShallow(supabase, b as BillRow);
    if ("error" in r) {
      result.failed++;
      result.errors.push({ bill_id: b.id, reason: r.error.slice(0, 200) });
    } else {
      result.enriched++;
    }
  }
  return result;
}
