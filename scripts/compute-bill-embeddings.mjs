/**
 * Compute Ollama embeddings for bills and (optionally) state briefings.
 * Phase 3 D6 — backs the cross-state-similarity query on /bills/[id].
 *
 * Pattern follows scripts/dedupe-news.mjs (in-prod since migration 0019):
 *   - Local Ollama with nomic-embed-text (free, no API key)
 *   - 768-dim float array stored as jsonb (no pgvector dependency)
 *   - Cosine similarity computed in application JS at query time
 *
 * Runs locally only — Ollama isn't available in the CI/cron environment.
 * The maintainer runs this when:
 *   - New bills land (LegiScan / OpenStates sync added them)
 *   - Bill text is refreshed (summary_ai changed)
 *   - State briefings are regenerated (daily cron, but embed lag is
 *     fine — similarity is a slow-moving signal)
 *
 * Idempotent: skips rows already embedded unless `--refresh` is set.
 *
 * Usage:
 *   ollama pull nomic-embed-text          # one-time
 *   ollama serve                          # in another terminal
 *   node --env-file=.env.local scripts/compute-bill-embeddings.mjs
 *
 * Flags:
 *   --refresh           re-embed everything (use sparingly)
 *   --target bills      only embed bills (default: bills + briefings)
 *   --target briefings  only embed briefings
 *   --limit N           stop after N rows per target (debug)
 */

import { createClient } from "@supabase/supabase-js";
import { OLLAMA_NUM_THREAD } from "./lib/ollama-options.mjs";

const args = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };
const flag = (n) => args.includes(n);

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = arg("--model", "nomic-embed-text");
const TARGET = arg("--target", "all"); // 'all' | 'bills' | 'briefings'
const LIMIT = parseInt(arg("--limit", "9999"), 10);
const REFRESH = flag("--refresh");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Ollama call. Mirrors the embed() function in dedupe-news.mjs so
// we use the same model + endpoint shape; we deliberately don't
// extract it to a shared helper yet (3rd duplication = extract).
// =============================================================
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text, options: { num_thread: OLLAMA_NUM_THREAD } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!Array.isArray(data.embedding)) throw new Error("No embedding in response");
  return data.embedding;
}

// =============================================================
// Text-to-embed builders. Keep these short and information-dense
// — embedding quality drops on padding/boilerplate. The 8k token
// context of nomic-embed-text is generous, but signal is in the
// first ~1k tokens for most rows.
// =============================================================
function billEmbedText(b) {
  // bill_number first because state-prefixed bill numbers (e.g.
  // "NJ S3170") are themselves a useful signal — the embedder
  // can learn that "S3170" and "HB 437" share a structural pattern.
  // Then title (the most discriminating field), then whichever
  // summary we have. Cap each piece so we don't drown legitimate
  // content in long boilerplate summary_ai.
  const parts = [
    `${b.state} ${b.bill_number}`,
    b.title?.slice(0, 200) ?? "",
    (b.summary || b.summary_ai || "").slice(0, 1500),
  ].filter(Boolean);
  return parts.join("\n").trim();
}

function briefingEmbedText(r) {
  // Briefings have section headers; we strip just the markdown
  // formatting marks to keep the embedder focused on prose.
  // The full body_md fits comfortably in nomic's context.
  return (r.body_md || "")
    .replace(/^#+ /gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\* /gm, "- ")
    .slice(0, 8000)
    .trim();
}

// =============================================================
// Generic embed-loop. Handles pagination, per-row error isolation,
// and idempotency.
// =============================================================
async function embedTable(label, table, textOf, selectCols, refreshFilter) {
  console.log(`\n=== ${label} ===`);
  // Use a SELECT-then-UPDATE flow rather than RPC because we want
  // to compute the text in application code (the schema-shape of
  // billEmbedText/briefingEmbedText is JS, not SQL).
  let q = sb.from(table).select(selectCols);
  if (!REFRESH) q = q.is("embedding", null);
  q = refreshFilter ? refreshFilter(q) : q;
  q = q.limit(LIMIT);
  const { data, error } = await q;
  if (error) { console.error(`  ${table} fetch failed:`, error.message); return { ok: 0, fail: 0 }; }
  console.log(`  ${data.length} rows to embed${REFRESH ? " (refresh mode)" : ""}`);
  let ok = 0, fail = 0;
  const t0 = Date.now();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const text = textOf(r);
    if (!text || text.length < 20) {
      // Empty/near-empty source — log + skip, don't fail.
      console.log(`  [${i + 1}/${data.length}] ${r.id.slice(0, 8)} skipped (empty text)`);
      continue;
    }
    try {
      const vec = await embed(text);
      const { error: upErr } = await sb
        .from(table)
        .update({ embedding: vec, embedded_at: new Date().toISOString() })
        .eq("id", r.id);
      if (upErr) throw upErr;
      ok++;
      if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${data.length} embedded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      fail++;
      console.log(`  [${i + 1}/${data.length}] ${r.id.slice(0, 8)} FAILED: ${String(e.message ?? e).slice(0, 120)}`);
    }
  }
  console.log(`  Done — ok=${ok} fail=${fail} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { ok, fail };
}

// =============================================================
// Verify Ollama is up before we waste time enumerating rows.
// =============================================================
try {
  const tags = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!tags.ok) throw new Error(`/api/tags returned ${tags.status}`);
  const list = await tags.json();
  const has = list?.models?.some(m => m.name?.startsWith(MODEL));
  if (!has) {
    console.error(`✗ Ollama is up but '${MODEL}' isn't installed. Run: ollama pull ${MODEL}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`✗ Ollama unreachable at ${OLLAMA_URL}: ${e.message}\n  Start it with: ollama serve`);
  process.exit(1);
}
console.log(`✓ Ollama up at ${OLLAMA_URL} with ${MODEL}`);

// =============================================================
// Run targeted embedders
// =============================================================
const wantBills = TARGET === "all" || TARGET === "bills";
const wantBriefings = TARGET === "all" || TARGET === "briefings";
const runStart = Date.now();

let billsRes = { ok: 0, fail: 0 };
let briefRes = { ok: 0, fail: 0 };

if (wantBills) {
  billsRes = await embedTable(
    "BILLS",
    "bills",
    billEmbedText,
    "id, state, bill_number, title, summary, summary_ai",
    (q) => q.eq("active", true),
  );
}

if (wantBriefings) {
  briefRes = await embedTable(
    "STATE BRIEFINGS",
    "state_briefings",
    briefingEmbedText,
    "id, state, body_md",
    (q) => q.eq("is_active", true),
  );
}

console.log("\n✓ Embedding run complete.");

// Self-monitoring (standing rule 6) — nightly box step since PR-D.
try {
  const ok = billsRes.ok + briefRes.ok;
  const fail = billsRes.fail + briefRes.fail;
  await sb.from("scraper_runs").insert({
    source: "bill_embeddings",
    started_at: new Date(runStart).toISOString(),
    finished_at: new Date().toISOString(),
    status: ok === 0 && fail > 0 ? "fail" : "success",
    rows_updated: ok,
    notes: `embedded=${ok} failed=${fail} model=${MODEL} target=${TARGET}`,
  });
} catch { /* best-effort */ }
