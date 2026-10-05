/**
 * Cross-state bill similarity via Ollama-computed embeddings.
 * Phase 3 D6 — the killer query for kratom-policy intel.
 *
 * Embeddings are jsonb 768-dim float arrays stored on the `bills` and
 * `state_briefings` tables. Computed locally via Ollama nomic-embed-text
 * (see scripts/compute-bill-embeddings.mjs).
 *
 * SCORING HAPPENS IN POSTGRES, not here (migrations 0254-0256). It used to
 * happen here: this module pulled every candidate bill WITH its embedding and
 * ran cosineSim() in Node. That was fine when it was written and stopped being
 * fine as the corpus grew — measured before the change, one call shipped 263
 * rows / 4 MB of jsonb out of the database to keep five of them, and it was the
 * third most expensive statement in the whole database (1,812s over 4,928
 * calls). The `similar_bills` RPC returns only the top N with their scores.
 *
 * Measured over 80 real comparisons, old path vs RPC: payload 284.40 MB ->
 * 0.10 MB (-99.965%), latency 743ms -> 293ms per call, and 0 result
 * mismatches — ids and similarity scores agree to 1e-9. That exactness is why
 * `bills.embedding_f8` is a float8[] generated column rather than pgvector:
 * pgvector stores float4 and would quietly disagree with cosineSim() in the
 * last few digits.
 *
 * Usage on /bills/[id]:
 *   const similar = await findSimilarBills(supabase, billId, { limit: 5 });
 *   // → [{ bill, similarity }, ...] sorted by similarity desc,
 *   //   excluding the target bill itself and (by default) bills from
 *   //   the same state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

/** One row as public.similar_bills() returns it: the bill's public columns plus its score. */
type SimilarBillRow = Omit<EmbeddedBillRow, "embedding"> & { similarity: number };

/**
 * Cosine similarity between two equal-length number arrays.
 * Identical to scripts/dedupe-news.mjs::cosineSim — kept in sync.
 *
 * No longer on the /bills/[id] path (Postgres scores there now), but kept and
 * still exported: it is the reference definition that public.float8_cosine_sim
 * mirrors, scripts/dedupe-news.mjs uses the same math, and
 * __tests__/bill-similarity.test.ts pins its behaviour. Delete it only
 * alongside those.
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
  // 0.6 default — empirically tuned for kratom bills via
  // nomic-embed-text. Cross-state KCPA matches land at 62-69%;
  // lowering further surfaces unrelated kratom bills.
  //
  // The candidate filter (active, embedded, anti/pro only, not the target,
  // and by default a different state) now lives in the RPC and is identical to
  // the one this function used to apply client side. The old hard 2000-row cap
  // is gone with it: it existed to bound the embedding payload after the
  // 2026-06-08 OOM RCA, and nothing large crosses the wire any more.
  const { data, error } = await supabase.rpc("similar_bills", {
    p_bill_id: billId,
    p_limit: opts.limit ?? 5,
    p_min_similarity: opts.minSimilarity ?? 0.6,
    p_include_same_state: opts.includeSameState ?? false,
  });
  if (error || !data) return [];

  return (data as SimilarBillRow[]).map(({ similarity, ...bill }) => ({ bill, similarity }));
}

/**
 * Cross-request CACHED variant for the public /bills/[id] page.
 *
 * Similar-bills for a given bill only change when embeddings are recomputed
 * (rare, via scripts/compute-bill-embeddings.mjs), so we cache the small
 * top-N result across requests (revalidate 24h, tag-invalidatable) rather than
 * re-running the query on EVERY page view. Uses a service-role client (the
 * bills it reads are public) because unstable_cache can't use the cookie-bound
 * request client.
 *
 * This cache was load-bearing when a miss meant pulling the whole embedding
 * corpus; since 0254-0256 a miss costs one RPC returning five rows, so it is
 * now an ordinary latency cache rather than the thing standing between the
 * page and a 4 MB read.
 */
export function findSimilarBillsCached(
  billId: string,
  opts: { limit?: number; minSimilarity?: number; includeSameState?: boolean } = {},
): Promise<SimilarBill[]> {
  const key = [
    "similar-bills",
    billId,
    String(opts.limit ?? 5),
    String(opts.minSimilarity ?? 0.6),
    String(opts.includeSameState ?? false),
  ];
  return unstable_cache(
    () => findSimilarBills(createServiceRoleClient(), billId, opts),
    key,
    { revalidate: 86400, tags: [`similar-bills:${billId}`] },
  )();
}
