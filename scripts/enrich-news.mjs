#!/usr/bin/env node
/**
 * iKratom — News enrichment via local Ollama.
 *
 * After `npm run sync:news:rss` populates raw articles, this script:
 *   - Finds news_items where summary is null
 *   - For each, asks the local Ollama instance to:
 *      (a) write a 2-sentence factual summary
 *      (b) score kratom relevance 0.00–1.00
 *      (c) classify topic (legislation/science/business/enforcement/culture)
 *   - Writes the enrichment back to the row
 *
 * Run with:
 *   node --env-file=.env.local scripts/enrich-news.mjs              # all unenriched
 *   node --env-file=.env.local scripts/enrich-news.mjs --limit 20   # cap batch
 *   node --env-file=.env.local scripts/enrich-news.mjs --model qwen2.5:7b
 *
 * Requires Ollama running locally (default http://localhost:11434).
 * Recommended models: llama3.1:8b (fast, good), qwen2.5:7b (very good for JSON),
 *                     gemma2:9b (alternative). Pull with: `ollama pull llama3.1:8b`
 */

import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders, providerNote, logProviderSummary } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
// Honoured by providers that accept a per-call model (Groq today) and by local
// Ollama when the router falls through to it. Null means "let the router decide".
const MODEL_OVERRIDE = modelIdx >= 0 ? args[modelIdx + 1] : null;
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SYSTEM = `You analyze news headlines about kratom for an advocacy platform.

Given a headline + source, return a JSON object with these EXACT fields:

1. summary — 2 short sentences based ONLY on the headline (don't fabricate details beyond what's there)

2. relevance — number 0.00 to 1.00. SCORING RULES:
   - 1.00: headline names kratom, mitragynine, mitragyna, kratomite, or 7-OH/7-hydroxymitragynine
   - 0.85: headline mentions "kratom retailers", "kratom shop", "kratom ban", "kratom regulation"
   - 0.70: headline references kratom industry, vendors, or specific kratom products
   - 0.30: weakly related ("herbal supplement" with no kratom mention)
   - 0.00: completely unrelated
   IMPORTANT: if "kratom" appears anywhere in the headline, relevance MUST be 0.70 or higher.

3. topic — exactly one of these strings (no others, no quotes-of-quotes):
   "legislation" — bills, laws, regulation, bans
   "science" — research, studies, medical findings
   "business" — vendors, retailers, sales, market, lawsuits over commerce
   "enforcement" — police actions, busts, FDA seizures, court cases
   "culture" — community, individual stories, lifestyle
   "other" — anything else kratom-related

Return ONLY the JSON object, nothing else. Example:
{"summary":"Oklahoma lawmakers introduced a bill regulating kratom sales. The bill targets the 7-OH alkaloid specifically.","relevance":0.95,"topic":"legislation"}`;

async function enrichOne(item) {
  const userPrompt = `Headline: ${item.title}\nSource: ${item.source_name ?? "Unknown"}\nURL: ${item.url}`;

  // THE FREE ROUTER, not a direct Ollama call (2026-09-21). This script spoke to
  // http://localhost:11434 and nothing else, so it could only ever run on the
  // owner's PC — which is why it was never added to a workflow, and why every
  // news_item kept the ai_relevance_score: 0.5 placeholder that sync-news-rss
  // writes with the comment "default; enrich:news adjusts". Nothing adjusted it.
  // 150 of 150 items in the last fortnight scored exactly 0.5, push-state-news
  // gates at >= 0.85, and so every state news notification silently sent nothing.
  //
  // aiRouter tries the free cloud providers and STILL falls through to local
  // Ollama last, so running this on the box behaves as before while CI can now
  // run it at all. The router is JSON-only, which suits this prompt exactly.
  const { parsed } = await aiRouter({
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 400,
    ...(MODEL_OVERRIDE ? { modelOverride: MODEL_OVERRIDE } : {}),
    verbose: false,
  });
  if (!parsed || typeof parsed !== "object") throw new Error("router returned no JSON object");

  const validTopics = new Set(["legislation", "science", "business", "enforcement", "culture", "other"]);
  const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : null;
  const relevance = typeof parsed.relevance === "number"
    ? Math.max(0, Math.min(1, parsed.relevance))
    : 0.5;
  const topic = validTopics.has(parsed.topic) ? parsed.topic : "other";

  return { summary, ai_relevance_score: relevance, kratom_topic: topic === "other" ? null : topic };
}

// ---------- main ----------
const t0 = Date.now();
console.log(`\nEnriching news via the free AI router (${listAvailableProviders().join(", ") || "none configured"})…\n`);

// No checkOllama() gate any more: it hard-exited when localhost:11434 was
// unreachable, which is every CI runner, and is the second half of why this
// script never ran in the cloud. The router decides what is reachable.

// THE QUEUE IS THE PLACEHOLDER, NOT THE MISSING SUMMARY (fixed 2026-09-21).
// This used to select `.is("summary", null)` — the exact same queue
// summarize-news.mjs claims hourly with a better, body-aware summary. Since
// that one actually runs, it drains the queue first, so scheduling this script
// on the old selector would have been a no-op: it would find nothing, the 0.5
// relevance placeholder would survive anyway, and the news notifications would
// stay silently dead. What is genuinely unfixed is the SCORE, so that is what
// this asks for. Exactly 0.5 is sync-news-rss's literal default; a real score
// landing on 0.5 is rare and re-scoring it costs one call.
const { data: items } = await supabase
  .from("news_items")
  .select("id, title, source_name, url, summary")
  .eq("active", true)
  .or("ai_relevance_score.eq.0.5,ai_relevance_score.is.null,summary.is.null")
  .limit(LIMIT);

if (!items || items.length === 0) {
  console.log("Nothing to enrich — all news items have summaries already.");
  await tag("empty", 0, 0);
  process.exit(0);
}

console.log(`Found ${items.length} items to enrich…\n`);

let done = 0, failed = 0;

for (const item of items) {
  process.stdout.write(`  [${done + 1}/${items.length}] ${item.title.slice(0, 60)}… `);
  try {
    const enrichment = await enrichOne(item);
    // Never clobber an existing summary: summarize-news.mjs writes a body-aware
    // one, while this prompt only ever sees the headline. Score and topic are
    // always ours to set — the score is the whole reason this runs.
    const patch = item.summary
      ? { ai_relevance_score: enrichment.ai_relevance_score, kratom_topic: enrichment.kratom_topic }
      : enrichment;
    const { error } = await supabase
      .from("news_items")
      .update(patch)
      .eq("id", item.id);
    if (error) {
      console.log(`DB ✗ ${error.message}`);
      failed++;
    } else {
      console.log(`✓ ${(enrichment.ai_relevance_score * 100).toFixed(0)}% · ${enrichment.kratom_topic ?? "?"}`);
      done++;
    }
  } catch (e) {
    console.log(`✗ ${e.message}`);
    failed++;
  }
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${done} enriched, ${failed} failed.`);
logProviderSummary("enrich-news providers");

// TELEMETRY, added with the router port. This script wrote NONE at all, so the
// fact that it had never run in the cloud was invisible to the staleness pager,
// to /admin/automation and to every audit — while the 0.5 placeholder it exists
// to replace quietly disabled the whole news notification path. Silence has to
// be detectable or it is not monitored.
await tag(done > 0 ? "success" : (failed > 0 ? "error" : "empty"), done, items.length);
process.exit(failed > items.length / 2 ? 1 : 0);

async function tag(status, added, processed) {
  try {
    await supabase.from("scraper_runs").insert({
      source: "enrich_news",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_added: added,
      rows_updated: processed,
      notes: `${added} enriched · ${failed} failed · ${providerNote()}`,
    });
  } catch { /* best-effort */ }
}
