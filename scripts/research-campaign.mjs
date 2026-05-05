#!/usr/bin/env node
/**
 * iKratom — Research-briefing agent for a campaign.
 *
 * Runs a local Ollama model with tool calling enabled to gather context
 * about a campaign's state and produce a one-page briefing the admin can
 * read before crafting email templates.
 *
 * Tools the agent can call:
 *   search_news(state, days?)
 *   search_bills(state)
 *   search_legislators(state, role?)
 *
 * Output shape (saved to campaigns.briefing as plain text):
 *   ## Landscape
 *   ## Active bills
 *   ## Recent news
 *   ## Recommended legislators to target
 *   ## Suggested talking points
 *
 * Run with:
 *   npm run research:campaign -- --slug oklahoma-7oh-ban
 *   npm run research:campaign -- --id <uuid>
 *   npm run research:campaign -- --slug ... --model hermes3:8b
 *
 * Recommended models (must support tool calling):
 *   hermes3:8b      best agentic loop, ~5GB
 *   llama3.1:8b     general-purpose, ~5GB
 *   llama3.3:70b    strongest reasoning, very slow
 *   qwen2.5:7b      strong reasoning + JSON, ~5GB
 *
 * Pull first: ollama pull hermes3:8b
 */

import { createClient } from "@supabase/supabase-js";
import { TOOLS_SCHEMA, dispatchTool } from "./research-tools.mjs";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const args = process.argv.slice(2);
const slug = argValue("--slug");
const id = argValue("--id");
const MODEL = argValue("--model") || "llama3.1:8b";
const MAX_TURNS = 6;

if (!slug && !id) {
  console.error("Usage: npm run research:campaign -- --slug <slug> | --id <uuid>");
  process.exit(1);
}

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    if (!models.some((m) => m === MODEL || m.startsWith(MODEL.split(":")[0]))) {
      console.error(`✗ Model "${MODEL}" not found. Available: ${models.join(", ")}`);
      console.error(`  Pull it: ollama pull ${MODEL}`);
      return false;
    }
    return true;
  } catch {
    console.error(`✗ Can't reach Ollama at ${OLLAMA_URL}.`);
    return false;
  }
}

const SYSTEM = `You are a research analyst preparing a briefing for a U.S. kratom advocacy campaign.

Your job: gather context using the available tools, then write a concise briefing the campaign admin can read in 60 seconds before crafting email templates.

Use tools to fetch:
- search_bills(state) — what's currently legislatively active
- search_news(state, days=90) — recent media coverage
- search_legislators(state, role=...) — who to potentially target

Then write the briefing as plain markdown with these sections:

## Landscape
2-3 sentences. What's the current kratom situation in this state? Pro? Anti? Mixed?

## Active bills
Bullet list. For each: bill number, 1-line summary, stance (pro/anti/neutral), latest action.

## Recent news
Bullet list. 3-5 most relevant headlines with date + 1-line context.

## Recommended legislators to target
Bullet list. Use search_legislators to find specific names. Prioritize anti-kratom officials for opposition campaigns or pro-kratom officials for thank-you campaigns. Include their contact info if available.

## Suggested talking points
3-5 bullets. Specific, factual, derived from the news + bills you found.

Be concrete. Cite specific bill numbers, headline dates, and legislator names. If a tool returns nothing, say so honestly.

When you have enough info, output the briefing as your final response WITHOUT making any more tool calls.`;

// ---------- main ----------
console.log(`\nResearching campaign with Ollama (${MODEL} @ ${OLLAMA_URL})…\n`);

if (!(await checkOllama())) process.exit(1);

// Load campaign
let q = supabase.from("campaigns").select("id, slug, title, blurb, state").limit(1);
q = id ? q.eq("id", id) : q.eq("slug", slug);
const { data: campRows, error: campErr } = await q;
if (campErr || !campRows?.[0]) { console.error(`Campaign not found: ${campErr?.message ?? "(no rows)"}`); process.exit(1); }
const campaign = campRows[0];

if (!campaign.state) {
  console.error(`Campaign ${campaign.slug} has no state — federal campaigns aren't supported by this tool yet.`);
  process.exit(1);
}

console.log(`Campaign: ${campaign.title} (${campaign.slug}, ${campaign.state})`);
console.log(`Goal: produce a research briefing.\n`);

const userPrompt =
  `Campaign: "${campaign.title}"\n` +
  `State: ${campaign.state}\n` +
  `Stated goal: ${campaign.blurb || "(no blurb)"}\n\n` +
  `Research the kratom legislative + news landscape for ${campaign.state} and write the briefing.`;

const messages = [
  { role: "system", content: SYSTEM },
  { role: "user", content: userPrompt },
];

let finalText = null;

for (let turn = 0; turn < MAX_TURNS; turn++) {
  process.stdout.write(`Turn ${turn + 1}/${MAX_TURNS}: `);
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: TOOLS_SCHEMA,
      stream: false,
      options: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) { console.log(`✗ Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
  const data = await res.json();
  const msg = data.message ?? {};

  // If the model wants to call tools, execute them and feed results back.
  const toolCalls = msg.tool_calls ?? [];
  if (toolCalls.length > 0) {
    console.log(`${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`);
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const fname = tc.function?.name;
      const fargs = tc.function?.arguments ?? {};
      console.log(`  → ${fname}(${JSON.stringify(fargs).slice(0, 80)})`);
      const result = await dispatchTool(supabase, fname, fargs);
      const summary = result?.count != null ? `${result.count} items` : "ok";
      console.log(`    ← ${summary}`);
      messages.push({
        role: "tool",
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
    continue; // next turn — let model see tool output
  }

  // No tool calls → final answer
  finalText = (msg.content ?? "").trim();
  console.log(`final answer (${finalText.length} chars)`);
  break;
}

if (!finalText) {
  console.error(`\n✗ Agent didn't produce a final briefing within ${MAX_TURNS} turns.`);
  process.exit(1);
}

console.log(`\n${"─".repeat(60)}\n${finalText}\n${"─".repeat(60)}\n`);

// Save to campaigns.briefing
const { error: saveErr } = await supabase
  .from("campaigns")
  .update({ briefing: finalText, briefing_generated_at: new Date().toISOString() })
  .eq("id", campaign.id);
if (saveErr) { console.error(`✗ Save failed: ${saveErr.message}`); process.exit(1); }

console.log(`✓ Briefing saved to campaigns.briefing for "${campaign.slug}".`);
console.log(`  View at /admin/campaigns/${campaign.id}/edit`);
