/**
 * Compute embeddings for bills and (optionally) state briefings.
 * Phase 3 D6 — backs the cross-state-similarity query on /bills/[id].
 *
 *   - 768-dim (or any width) float array stored as jsonb — no pgvector
 *   - Cosine similarity computed in application JS at query time
 *
 * RUNS IN THE CLOUD SINCE 2026-09-17. It used to require a local Ollama
 * serving nomic-embed-text, which is why `bill_embeddings` was the last
 * compute dependency on the owner's PC: with the box off, cross-state bill
 * similarity silently went stale. It now goes through lib/embed-router.mjs
 * and will use whichever free provider has a key (Cloudflare bge-base,
 * Gemini gemini-embedding-001, Mistral mistral-embed), falling back to a
 * local Ollama when one is actually running.
 *
 * THE INTERLOCK. Vectors from two different models are not comparable — they
 * are the same shape and cosineSim() will return a confident, meaningless
 * number for a bge-vs-nomic pair. So this script refuses to top up a corpus
 * that a DIFFERENT model wrote: it reads the model recorded by the last
 * successful `bill_embeddings` scraper_runs row and, if the active provider
 * disagrees, stops and tells you to re-embed everything with --refresh. That
 * is the whole safety story for a provider switch; there is no schema column
 * to keep in sync and nothing to migrate.
 *
 * Idempotent: skips rows already embedded unless `--refresh` is set.
 *
 * Usage:
 *   node --env-file=.env.local scripts/compute-bill-embeddings.mjs
 *   EMBED_PROVIDER=ollama node --env-file=.env.local scripts/compute-bill-embeddings.mjs
 *
 * Flags:
 *   --refresh           re-embed everything (REQUIRED when changing provider)
 *   --provider NAME     force one provider (same as EMBED_PROVIDER)
 *   --target bills      only embed bills (default: bills + briefings)
 *   --target briefings  only embed briefings
 *   --limit N           stop after N rows per target (debug)
 */

import { createClient } from "@supabase/supabase-js";
import { embed, activeEmbedProvider } from "./lib/embed-router.mjs";

const args = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };
const flag = (n) => args.includes(n);

const PROVIDER_OVERRIDE = arg("--provider", null);
if (PROVIDER_OVERRIDE) process.env.EMBED_PROVIDER = PROVIDER_OVERRIDE;
const TARGET = arg("--target", "all"); // 'all' | 'bills' | 'briefings'
const LIMIT = parseInt(arg("--limit", "9999"), 10);
const REFRESH = flag("--refresh");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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
// Provider preflight + the cross-model interlock.
//
// One real embed proves the key works and tells us the width, before we
// spend time enumerating rows. Then we compare the active model against
// whatever wrote the corpus last; disagreeing without --refresh is the
// failure mode this script exists to prevent.
// =============================================================
let provider;
try {
  provider = activeEmbedProvider();
} catch (e) {
  console.error(`✗ ${e.message}\n  Set one of CLOUDFLARE_AI_TOKEN+CLOUDFLARE_ACCOUNT_ID, GEMINI_API_KEY,`);
  console.error("  MISTRAL_API_KEY (with EMBED_DIMS=1024), or run Ollama locally.");
  process.exit(1);
}

let probeDims;
try {
  probeDims = (await embed("kratom regulation preflight")).length;
} catch (e) {
  console.error(`✗ ${provider.id}/${provider.model} could not embed: ${String(e.message ?? e).slice(0, 200)}`);
  console.error("  Run scripts/diagnose-cloud-gaps.mjs to see which providers are answering today.");
  process.exit(1);
}
const MODEL = `${provider.id}/${provider.model}`;
console.log(`✓ ${MODEL} up, ${probeDims} dims`);

// What wrote the corpus last? scraper_runs.notes has carried `model=` since
// this script first ran, so it is the record we already have — no new column.
const { data: lastRun } = await sb
  .from("scraper_runs")
  .select("notes, finished_at")
  .eq("source", "bill_embeddings")
  .eq("status", "success")
  .order("finished_at", { ascending: false })
  .limit(1);
const priorModel = lastRun?.[0]?.notes?.match(/model=(\S+)/)?.[1] ?? null;

if (priorModel && priorModel !== MODEL && !REFRESH) {
  console.error(`\n✗ Corpus was embedded by ${priorModel}; this run would use ${MODEL}.`);
  console.error("  Two models' vectors are not comparable, and filling gaps with a second");
  console.error("  model corrupts similarity silently. Re-embed the whole corpus instead:");
  console.error(`    node scripts/compute-bill-embeddings.mjs --refresh --provider ${provider.id}`);
  console.error("  (or pin the old one with --provider, if it is still reachable).");
  process.exit(1);
}
if (priorModel && priorModel !== MODEL) {
  console.log(`  --refresh: replacing the ${priorModel} corpus with ${MODEL}`);
}

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
    notes: `embedded=${ok} failed=${fail} model=${MODEL} dims=${probeDims} target=${TARGET}`,
  });
} catch { /* best-effort */ }
