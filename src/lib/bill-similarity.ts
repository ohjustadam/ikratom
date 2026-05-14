/**
 * Cross-state bill similarity via Ollama-computed embeddings.
 * Phase 3 D6 — the killer query for kratom-policy intel.
 *
 * Embeddings are jsonb 768-dim float arrays stored on the `bills` and
 * `state_briefings` tables. Computed locally via Ollama nomic-embed-text
 * (see scripts/compute-bill-embeddings.mjs). We deliberately avoided
 * pgvector to keep dependencies thin — at <500 active bills, cosine
 * similarity computed in application JS is fine (<50ms).
 *
 * Usage on /bills/[id]:
 *   const similar = await findSimilarBills(supabase, billId, { limit: 5 });
 *   // → [{ bill, similarity }, ...] sorted by similarity desc,
 *   //   excluding the target bill itself and (by default) bills from
 *   //   the same state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type EmbeddedBillRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  kratom_relevance: string | null;
  status: string | null;
  last_action_at: string | null;
  embedding: number[] | null;
};

export type SimilarBill = {
  bill: Omit<EmbeddedBillRow, "embedding">;
  similarity: number;
};

/**
 * Cosine similarity between two equal-length number arrays.
 * Identical to scripts/dedupe-news.mjs::cosineSim — kept in sync.
 */
export function cosineSim(a: number[], b: number[]): number {
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

/**
 * Find bills similar to the given bill across (by default) other states.
 *
 * Default semantics: "show me the closest cross-state matches" — the
 * killer use case is "NJ introduces a new KCPA → instantly see the TX
 * HB 5 2024 it's plagiarized from." When `includeSameState=true`,
 * we also surface in-state bills (e.g. companion House/Senate versions).
 */
export async function findSimilarBills(
  supabase: SupabaseClient,
  billId: string,
  opts: { limit?: number; minSimilarity?: number; includeSameState?: boolean } = {},
): Promise<SimilarBill[]> {
  const limit = opts.limit ?? 5;
  // 0.6 default — empirically tuned for kratom bills via
  // nomic-embed-text. Cross-state KCPA matches land at 62-69%;
  // lowering further surfaces unrelated kratom bills.
  const minSimilarity = opts.minSimilarity ?? 0.6;
  const includeSameState = opts.includeSameState ?? false;

  // Fetch the target bill's embedding + state
  const { data: target, error: tErr } = await supabase
    .from("bills")
    .select("id, state, embedding")
    .eq("id", billId)
    .maybeSingle<{ id: string; state: string; embedding: number[] | null }>();
  if (tErr || !target?.embedding || !Array.isArray(target.embedding)) return [];

  // Pull all other embedded active bills. At ~500 rows × 768 floats this
  // is a ~1.5 MB payload — acceptable for one query, and most rows will
  // be excluded before we render anything. If this grows past 2k rows
  // we should pre-filter by kratom_relevance or chunk by state.
  let q = supabase
    .from("bills")
    .select("id, state, bill_number, title, kratom_relevance, status, last_action_at, embedding")
    .eq("active", true)
    .not("embedding", "is", null)
    .neq("id", billId);
  if (!includeSameState) q = q.neq("state", target.state);

  const { data: candidates, error: cErr } = await q;
  if (cErr || !candidates) return [];

  const scored: SimilarBill[] = [];
  for (const c of candidates as EmbeddedBillRow[]) {
    if (!c.embedding || !Array.isArray(c.embedding)) continue;
    const sim = cosineSim(target.embedding, c.embedding);
    if (sim < minSimilarity) continue;
    const { embedding: _e, ...rest } = c;
    void _e;
    scored.push({ bill: rest, similarity: sim });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
