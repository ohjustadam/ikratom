#!/usr/bin/env node
/**
 * iKratom — News deduplication via local Ollama embeddings.
 *
 * Same wire-service article often syndicates to 8+ states. This script
 * embeds each headline+summary using `nomic-embed-text` and links syndicated
 * copies to a single canonical row via news_items.duplicate_of.
 *
 * Strategy:
 *   1. Pull all news items missing an embedding (or all if --refresh)
 *   2. For each, request embedding from Ollama (768-dim float vector)
 *   3. Store as jsonb in news_items.embedding
 *   4. Compare to existing canonicals (rows where duplicate_of IS NULL).
 *      If cosine similarity >= threshold (default 0.90), link as duplicate.
 *   5. Otherwise this row stays as its own canonical (no link).
 *
 * The trigger from migration 0019 keeps duplicate_count in sync on the
 * canonical row, so the news page can show "also reported in 4 other states".
 *
 * Run with:
 *   npm run dedupe:news                          # all unembedded
 *   npm run dedupe:news -- --threshold 0.88      # tune similarity cutoff
 *   npm run dedupe:news -- --refresh             # re-embed everything
 *   npm run dedupe:news -- --model mxbai-embed-large  # different embed model
 *
 * Requires Ollama running locally. Pull the embedding model first:
 *   ollama pull nomic-embed-text
 */

import { createClient } from "@supabase/supabase-js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : "nomic-embed-text";
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 5000;
const threshIdx = args.indexOf("--threshold");
const THRESHOLD = threshIdx >= 0 ? parseFloat(args[threshIdx + 1]) : 0.90;
const REFRESH = args.includes("--refresh");

if (THRESHOLD <= 0 || THRESHOLD >= 1) {
  console.error("--threshold must be between 0 and 1 (default 0.90)"); process.exit(1);
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

/** Embed a single text string. Returns float[] (768-dim for nomic-embed-text). */
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!Array.isArray(data.embedding)) throw new Error("No embedding in response");
  return data.embedding;
}

/** Cosine similarity between two equal-length number arrays. */
function cosineSim(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- main ----------
console.log(`\nDeduping news with Ollama embeddings (${MODEL} @ ${OLLAMA_URL})…`);
console.log(`Similarity threshold: ${THRESHOLD}\n`);

const ok = await checkOllama();
if (!ok) process.exit(1);

// 1. Pull canonicals (rows with embedding, not themselves duplicates) for comparison.
//    These accumulate as we process; we update the in-memory list as we go.
console.log("Loading existing canonicals…");
const { data: canonicalRows, error: canErr } = await supabase
  .from("news_items")
  .select("id, title, summary, state, embedding")
  .eq("active", true)
  .is("duplicate_of", null)
  .not("embedding", "is", null);
if (canErr) { console.error("DB error:", canErr.message); process.exit(1); }

const canonicals = (canonicalRows ?? [])
  .filter((c) => Array.isArray(c.embedding))
  .map((c) => ({
    id: c.id,
    title: c.title,
    state: c.state,
    embedding: c.embedding,
  }));
console.log(`  ${canonicals.length} existing canonicals loaded.\n`);

// 2. Pull rows to process.
let q = supabase
  .from("news_items")
  .select("id, title, summary, state")
  .eq("active", true)
  .order("published_at", { ascending: true, nullsFirst: true })
  .limit(LIMIT);
if (!REFRESH) q = q.is("embedding", null);

const { data: items, error: fetchErr } = await q;
if (fetchErr) { console.error("DB fetch error:", fetchErr.message); process.exit(1); }

if (!items || items.length === 0) {
  console.log("Nothing to embed — all news is up to date.");
  console.log("(Pass --refresh to re-embed everything.)");
  process.exit(0);
}

console.log(`Embedding + matching ${items.length} item${items.length === 1 ? "" : "s"}…\n`);

let done = 0, failed = 0, dupesFound = 0;
const t0 = Date.now();

for (const item of items) {
  const label = `${item.state ?? "FED"} · ${(item.title ?? "").slice(0, 55)}`;
  process.stdout.write(`  [${done + failed + 1}/${items.length}] ${label}… `);

  try {
    const text = `${item.title ?? ""}\n${item.summary ?? ""}`.trim().slice(0, 4000);
    const vec = await embed(text);

    // Find best canonical match
    let best = null;
    let bestSim = 0;
    for (const c of canonicals) {
      if (c.id === item.id) continue;
      const sim = cosineSim(vec, c.embedding);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }

    const update = {
      embedding: vec,
      embedded_at: new Date().toISOString(),
    };
    if (best && bestSim >= THRESHOLD) {
      update.duplicate_of = best.id;
      dupesFound++;
    } else {
      update.duplicate_of = null;
      // This becomes a new canonical for future items in this run
      canonicals.push({ id: item.id, title: item.title, state: item.state, embedding: vec });
    }

    const { error } = await supabase.from("news_items").update(update).eq("id", item.id);
    if (error) {
      console.log(`DB ✗ ${error.message}`);
      failed++;
    } else {
      if (best && bestSim >= THRESHOLD) {
        console.log(`↪ dup of ${best.state ?? "FED"} (${(bestSim * 100).toFixed(0)}%)`);
      } else {
        console.log(`★ canonical${best ? ` (best ${(bestSim * 100).toFixed(0)}%)` : ""}`);
      }
      done++;
    }
  } catch (e) {
    console.log(`✗ ${e.message}`);
    failed++;
  }
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${done} embedded, ${dupesFound} flagged as duplicates, ${failed} failed.`);
console.log(`  Canonical articles in dataset: ${canonicals.length}`);
process.exit(failed > items.length / 2 ? 1 : 0);
