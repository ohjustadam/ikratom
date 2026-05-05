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

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : "llama3.1:8b";
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SYSTEM = `You analyze news headlines about kratom for an advocacy platform.
Given a headline + source, return a JSON object with these exact fields:
- summary: a 2-sentence neutral summary based ONLY on the headline (don't fabricate details)
- relevance: number 0.00 to 1.00, how directly the article is about kratom (1.00 = headline mentions kratom/mitragynine/7-OH; 0.00 = barely related)
- topic: one of "legislation", "science", "business", "enforcement", "culture", or "other"

Return ONLY the JSON, no prose. Example:
{"summary":"Oklahoma lawmakers introduced a bill to regulate kratom sales. The bill targets the 7-OH alkaloid specifically.","relevance":0.95,"topic":"legislation"}`;

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    if (!models.some((m) => m === MODEL || m.startsWith(MODEL.split(":")[0]))) {
      console.error(`✗ Ollama is running but model "${MODEL}" not found.`);
      console.error(`  Available: ${models.join(", ") || "(none)"}`);
      console.error(`  Pull it: ollama pull ${MODEL}`);
      return false;
    }
    return true;
  } catch {
    console.error(`✗ Can't reach Ollama at ${OLLAMA_URL}.`);
    console.error(`  Start it (system tray icon, or run \`ollama serve\` in a terminal).`);
    return false;
  }
}

async function enrichOne(item) {
  const userPrompt = `Headline: ${item.title}\nSource: ${item.source_name ?? "Unknown"}\nURL: ${item.url}`;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      format: "json",  // ask Ollama to enforce JSON output
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Bad JSON: ${raw.slice(0, 100)}`);
  }

  const validTopics = new Set(["legislation", "science", "business", "enforcement", "culture", "other"]);
  const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : null;
  const relevance = typeof parsed.relevance === "number"
    ? Math.max(0, Math.min(1, parsed.relevance))
    : 0.5;
  const topic = validTopics.has(parsed.topic) ? parsed.topic : "other";

  return { summary, ai_relevance_score: relevance, kratom_topic: topic === "other" ? null : topic };
}

// ---------- main ----------
console.log(`\nEnriching news with Ollama (${MODEL} @ ${OLLAMA_URL})…\n`);

const ok = await checkOllama();
if (!ok) process.exit(1);

const { data: items } = await supabase
  .from("news_items")
  .select("id, title, source_name, url")
  .eq("active", true)
  .is("summary", null)
  .limit(LIMIT);

if (!items || items.length === 0) {
  console.log("Nothing to enrich — all news items have summaries already.");
  console.log("(Run `npm run sync:news:rss` first if the queue is empty.)");
  process.exit(0);
}

console.log(`Found ${items.length} items to enrich…\n`);

let done = 0, failed = 0;
const t0 = Date.now();

for (const item of items) {
  process.stdout.write(`  [${done + 1}/${items.length}] ${item.title.slice(0, 60)}… `);
  try {
    const enrichment = await enrichOne(item);
    const { error } = await supabase
      .from("news_items")
      .update(enrichment)
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
process.exit(failed > items.length / 2 ? 1 : 0);
