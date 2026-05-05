#!/usr/bin/env node
/**
 * iKratom — Bills enrichment via local Ollama.
 *
 * After `npm run sync:bills` populates raw bill rows from OpenStates, this
 * script asks the local Ollama instance to:
 *   (a) write a 2-sentence plain-English summary (summary_ai)
 *   (b) write a 1-sentence "what advocates need to know" callout (advocacy_callout)
 *   (c) classify stance: pro / anti / neutral, with confidence 0.00-1.00
 *
 * Updates kratom_relevance only when AI confidence >= 0.60. Below that we
 * leave the keyword-based classification alone.
 *
 * Run with:
 *   npm run enrich:bills                                # all unenriched / stale
 *   npm run enrich:bills -- --limit 20                  # cap batch
 *   npm run enrich:bills -- --model qwen2.5:7b          # different model
 *   npm run enrich:bills -- --refresh                   # re-enrich everything
 *
 * Requires Ollama running locally (default http://localhost:11434).
 * Recommended models: llama3.1:8b (fast, good), qwen2.5:7b (best for JSON).
 */

import { createClient } from "@supabase/supabase-js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : "llama3.1:8b";
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 1000;
const REFRESH = args.includes("--refresh");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SYSTEM = `You analyze U.S. state legislation about kratom for an advocacy platform.

Given a bill's number, title, official summary, and last action, return a JSON object with these EXACT fields:

1. summary_ai — exactly 2 short sentences in plain English. What does this bill DO? Don't fabricate details beyond what's in the inputs.

2. advocacy_callout — exactly 1 sentence. Why should kratom advocates care? What action / message is implied?
   Examples:
   - "This bill would ban kratom retail sales statewide — advocates should oppose."
   - "This bill regulates 7-OH but explicitly preserves traditional kratom — advocates can support."
   - "This bill is procedural; no immediate impact on kratom availability."

3. stance — exactly one of these strings: "pro" | "anti" | "neutral"
   - "pro" — the bill protects, regulates reasonably, or otherwise benefits the kratom community
   - "anti" — the bill bans, restricts harmfully, or otherwise harms the kratom community
   - "neutral" — procedural, study-only, or genuinely mixed

4. confidence — number 0.00 to 1.00 indicating how sure you are about the stance classification

Return ONLY the JSON object, nothing else. Example:
{"summary_ai":"This bill would prohibit the sale of kratom products containing more than 2% mitragynine. It also requires age-restricted purchase for any kratom product.","advocacy_callout":"Advocates should oppose the alkaloid cap as it would effectively ban most natural leaf product.","stance":"anti","confidence":0.85}`;

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

async function enrichOne(bill) {
  const userPrompt =
    `Bill: ${bill.state} ${bill.bill_number}\n` +
    `Title: ${bill.title ?? "(none)"}\n` +
    `Official summary: ${bill.summary ?? "(none)"}\n` +
    `Last action: ${bill.last_action ?? "(none)"}`;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      format: "json",
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
  } catch {
    throw new Error(`Bad JSON: ${raw.slice(0, 100)}`);
  }

  const summaryAi = typeof parsed.summary_ai === "string" ? parsed.summary_ai.slice(0, 1000) : null;
  const callout = typeof parsed.advocacy_callout === "string" ? parsed.advocacy_callout.slice(0, 500) : null;
  const validStance = new Set(["pro", "anti", "neutral"]);
  const stance = validStance.has(parsed.stance) ? parsed.stance : null;
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;

  return { summaryAi, callout, stance, confidence };
}

// ---------- main ----------
console.log(`\nEnriching bills with Ollama (${MODEL} @ ${OLLAMA_URL})…\n`);

const ok = await checkOllama();
if (!ok) process.exit(1);

let q = supabase
  .from("bills")
  .select("id, state, bill_number, title, summary, last_action, kratom_relevance, enriched_at")
  .eq("active", true)
  .limit(LIMIT);
if (!REFRESH) q = q.is("enriched_at", null);

const { data: bills, error: fetchErr } = await q;
if (fetchErr) { console.error("DB fetch error:", fetchErr.message); process.exit(1); }

if (!bills || bills.length === 0) {
  console.log("Nothing to enrich — all bills are up to date.");
  console.log("(Run `npm run sync:bills` first if the queue is empty, or pass --refresh to re-process.)");
  process.exit(0);
}

console.log(`Found ${bills.length} bill${bills.length === 1 ? "" : "s"} to enrich…\n`);

let done = 0, failed = 0, stanceUpdated = 0;
const t0 = Date.now();

for (const bill of bills) {
  const tag = `${bill.state} ${bill.bill_number}`;
  process.stdout.write(`  [${done + failed + 1}/${bills.length}] ${tag.padEnd(14)} ${(bill.title ?? "").slice(0, 50)}… `);
  try {
    const r = await enrichOne(bill);
    const update = {
      summary_ai: r.summaryAi,
      advocacy_callout: r.callout,
      relevance_confidence: r.confidence,
      enriched_at: new Date().toISOString(),
    };
    // Only overwrite stance when AI is confident enough
    if (r.stance && r.confidence >= 0.6) {
      update.kratom_relevance = r.stance;
      if (r.stance !== bill.kratom_relevance) stanceUpdated++;
    }

    const { error } = await supabase.from("bills").update(update).eq("id", bill.id);
    if (error) {
      console.log(`DB ✗ ${error.message}`);
      failed++;
    } else {
      const conf = (r.confidence * 100).toFixed(0);
      console.log(`✓ ${r.stance ?? "?"} ${conf}%`);
      done++;
    }
  } catch (e) {
    console.log(`✗ ${e.message}`);
    failed++;
  }
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${done} enriched, ${failed} failed, ${stanceUpdated} stance updates.`);
process.exit(failed > bills.length / 2 ? 1 : 0);
