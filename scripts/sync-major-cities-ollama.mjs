#!/usr/bin/env node
/**
 * Local-officials sweep using local Ollama (offline, unlimited).
 *
 * Mirrors scripts/sync-state-capitals.mjs (Gemini grounded version) but
 * runs entirely on the owner's machine. Trade-off:
 *
 *   Gemini version              Ollama version (this file)
 *   ──────────────              ──────────────────────────
 *   ✓ web grounding             ✗ no live web
 *   ✗ 1,500/day cap             ✓ unlimited
 *   ✓ ~10s/city                 ✗ ~30s/city on llama3.3:70b
 *   ✓ better factual recall     ~ depends on model + prompt
 *
 * Recommendation: use Gemini for fresh sweeps where accuracy matters,
 * use this Ollama version for top-up runs / re-checks / cities Gemini
 * couldn't ground (rural / small-town with no .gov website).
 *
 * The output format is identical to the Gemini script — same `locals`
 * table inserts, same fields. Idempotent on re-run (skips cities that
 * already have officials).
 *
 * Run:
 *   npm run sync:cities:ollama                  # all 50 states
 *   npm run sync:cities:ollama OK               # single state
 *   npm run sync:cities:ollama OK "Tulsa"       # single city
 *
 * Requires:
 *   - OLLAMA_HOST (default http://127.0.0.1:11434)
 *   - OLLAMA_DEFAULT_MODEL (default llama3.3:70b — needs solid model)
 *   - SUPABASE service role + URL
 */

import { createClient } from "@supabase/supabase-js";
import { STATE_CITIES } from "./major-cities.mjs";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.3:70b";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SYSTEM = `You are a research assistant who knows current US local government officials.

Return ONLY a JSON object with this exact shape:
{
  "officials": [
    {
      "full_name": "Jane Doe",
      "role": "mayor" | "city_council",
      "title": "Mayor" | "Council Member, District 4",
      "district": "4" | null,
      "email": null,
      "phone": null,
      "website": null,
      "party": "Democratic" | "Republican" | "Nonpartisan" | null,
      "source_note": "Knowledge cutoff: <year>"
    }
  ]
}

Rules:
- Include the Mayor + city council members you're confident about.
- If unsure about a city, return officials: [].
- We will cross-reference contacts (email/phone/website) elsewhere; leave them null.
- Output ONLY the JSON object, no prose, no markdown.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ollamaJson(city, state) {
  const r = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: `List the current Mayor and City Council members of ${city}, ${state}.`,
      system: SYSTEM,
      stream: false,
      format: "json",
      options: { temperature: 0, num_predict: 4096 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text().catch(() => "")}`);
  const data = await r.json();
  return JSON.parse(data.response);
}

async function alreadyHasOfficials(city, state) {
  const { count } = await supabase
    .from("locals")
    .select("id", { count: "exact", head: true })
    .eq("city", city)
    .eq("state", state);
  return (count ?? 0) > 0;
}

async function insertOfficials(city, state, officials) {
  if (!officials.length) return 0;
  const rows = officials.map((o) => ({
    city,
    state,
    full_name: o.full_name,
    role: o.role,
    title: o.title ?? null,
    district: o.district ?? null,
    email: o.email ?? null,
    phone: o.phone ?? null,
    website: o.website ?? null,
    party: o.party ?? null,
    source_note: o.source_note ?? `Ollama ${OLLAMA_MODEL} (offline)`,
  }));
  const { error, data } = await supabase.from("locals").insert(rows).select("id");
  if (error) throw error;
  return (data ?? []).length;
}

async function processCity(city, state) {
  if (await alreadyHasOfficials(city, state)) {
    console.log(`  – ${city}, ${state}: already has officials, skip`);
    return 0;
  }
  const t = Date.now();
  try {
    const result = await ollamaJson(city, state);
    const officials = Array.isArray(result.officials) ? result.officials : [];
    const inserted = await insertOfficials(city, state, officials);
    console.log(`  ✓ ${city}, ${state}: ${inserted} officials in ${Math.round((Date.now() - t) / 1000)}s`);
    return inserted;
  } catch (e) {
    console.log(`  ✗ ${city}, ${state}: ${e.message?.slice(0, 200) ?? e}`);
    return 0;
  }
}

const args = process.argv.slice(2);
const stateFilter = args[0]?.toUpperCase();
const cityFilter = args[1];

const targets = [];
for (const [state, cities] of Object.entries(STATE_CITIES)) {
  if (stateFilter && state !== stateFilter) continue;
  for (const city of cities) {
    if (cityFilter && city !== cityFilter) continue;
    targets.push({ state, city });
  }
}

console.log(`\nOllama major-cities sweep`);
console.log(`Model: ${OLLAMA_MODEL}    Targets: ${targets.length}`);
console.log("─".repeat(60));

let total = 0;
const start = Date.now();
for (const { state, city } of targets) {
  total += await processCity(city, state);
  await sleep(500); // tiny breath between calls
}

console.log("─".repeat(60));
console.log(`Done: ${total} officials inserted across ${targets.length} cities in ${Math.round((Date.now() - start) / 1000)}s.`);
console.log("\nNote: Ollama answers reflect its training cutoff. Re-verify high-stakes officials with the Gemini-grounded sweep when possible.");
