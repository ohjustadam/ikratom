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
import { toolChat, ollamaToolModel, availableToolProviders } from "./lib/tool-chat.mjs";

const args = process.argv.slice(2);
const slug = argValue("--slug");
const id = argValue("--id");
// --model still names the OLLAMA model (callers pass hermes3:8b). It is now a
// PREFERENCE, not a requirement: lib/tool-chat runs the identical tool loop on
// any of the free OpenAI-compatible providers when Ollama is not up. Before
// this, no Ollama meant no briefing anywhere but the owner's PC.
if (argValue("--model")) process.env.OLLAMA_TOOL_MODEL = argValue("--model");
const PROVIDER = argValue("--provider") || null;
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
const localModel = await ollamaToolModel();
const cloud = availableToolProviders();
console.log(`\nResearching campaign — local:${localModel ?? "none"} cloud:[${cloud.join(", ") || "none"}]\n`);
if (!localModel && cloud.length === 0) {
  console.error("✗ No tool-capable provider: Ollama is not up and no free-tier key is set.");
  process.exit(1);
}

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
let usedProvider = null, usedModel = null;

try {
  const run = await toolChat({
    messages,
    tools: TOOLS_SCHEMA,
    dispatch: (name, fargs) => dispatchTool(supabase, name, fargs),
    maxTurns: MAX_TURNS,
    maxTokens: 2048,
    timeoutMs: 180_000,
    providerOverride: PROVIDER,
    onEvent: (e) => {
      if (e.type === "tool") console.log(`  → ${e.name}(${JSON.stringify(e.args).slice(0, 80)})  [${e.provider}]`);
      if (e.type === "provider-failed") console.log(`  ↻ ${e.provider} failed: ${e.error}`);
      if (e.type === "done") console.log(`  ✓ ${e.provider} wrote the briefing in ${e.turns} turn(s)`);
    },
  });
  finalText = (run.text ?? "").trim();
  usedProvider = run.provider;
  usedModel = run.model;
} catch (e) {
  console.error(`\n✗ ${String(e.message ?? e)}`);
  process.exit(1);
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

console.log(`✓ Briefing saved to campaigns.briefing for "${campaign.slug}" (via ${usedProvider}/${usedModel}).`);
console.log(`  View at /admin/campaigns/${campaign.id}/edit`);
