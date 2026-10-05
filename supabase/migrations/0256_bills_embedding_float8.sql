-- 0256_bills_embedding_float8.sql
--
-- INTENT: store the bill embedding in a numeric type so scoring it in the
-- database is actually fast, not merely cheap on egress.
--
-- Where this stands after 0254/0255, all measured over 80 real comparisons:
--
--   payload    284.40 MB -> 0.10 MB   (99.965% less; this was the goal)
--   agreement  0 mismatches, ids and scores identical to 1e-9
--   latency    869 ms/call (JS)  ->  1907 ms (0254)  ->  1297 ms (0255)
--
-- 0255 removed the per-element jsonb lookups and the redundant re-parse of the
-- target vector, which bought 32%. The remaining gap is the storage format
-- itself: `embedding` is jsonb, so every candidate must be serialized to text
-- and re-parsed as an array literal on every call. Node never pays that — the
-- HTTP layer hands it an already-parsed array and the cosine loop is tight
-- float math. No amount of SQL tuning wins while the data is jsonb.
--
-- So derive a real float8[] alongside it, as a STORED GENERATED column. That
-- needs no backfill script and no change to
-- scripts/compute-bill-embeddings.mjs: the column is maintained by Postgres on
-- every insert and update of `embedding`, so it cannot drift from its source
-- the way a trigger-maintained or script-maintained copy could. jsonb is left
-- as the source of truth, untouched.
--
-- WHY float8[] AND NOT pgvector: pgvector is available on this project and
-- would be faster still with an HNSW index. But `vector` stores float4 (single
-- precision), so its scores would differ from the float64 cosine computed in
-- cosineSim() — and "identical to the JS path to 1e-9" is a property this
-- change set has actually verified and that I would rather keep than trade for
-- milliseconds on a path that is cached for 24 hours. float8[] preserves exact
-- agreement. pgvector remains the right move if bill volume ever makes a
-- linear scan of the corpus untenable; at 263 candidates it is not.
--
-- COST: 681 live bills x 768 float8 = ~4.2 MB. The database is at 59.0% of its
-- 512 MB cap, and the cap never resets, so this is a deliberate spend.
--
-- LOCK: adding a STORED generated column rewrites the table (ACCESS EXCLUSIVE).
-- bills is 681 rows / 33 MB including indexes, so this is sub-second.
--
-- ROLLBACK:
--   ALTER TABLE public.bills DROP COLUMN IF EXISTS embedding_f8;
-- then re-apply 0255's similar_bills() body, which reads the jsonb directly.
-- Dropping the column cannot lose data: it is derived from `embedding`.

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS embedding_f8 double precision[]
  GENERATED ALWAYS AS (public.jsonb_to_float8_array(embedding)) STORED;

COMMENT ON COLUMN public.bills.embedding_f8 IS
  'Generated from `embedding` (jsonb) by jsonb_to_float8_array. Exists so '
  'similar_bills() can compute cosine over native float8 instead of '
  're-parsing jsonb per candidate. Never written directly — Postgres maintains '
  'it. jsonb remains the source of truth.';

-- ---------------------------------------------------------------------------
-- similar_bills(), now reading the numeric column. Same candidate filter, same
-- ordering, same results — only the vector source changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.similar_bills(
  p_bill_id            uuid,
  p_limit              integer          DEFAULT 5,
  p_min_similarity     double precision DEFAULT 0.6,
  p_include_same_state boolean          DEFAULT false
)
RETURNS TABLE (
  id               uuid,
  state            text,
  bill_number      text,
  title            text,
  kratom_relevance text,
  status           text,
  last_action_at   date,
  similarity       double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH target AS (
    SELECT b.id, b.state, b.embedding_f8 AS vec
      FROM public.bills b
     WHERE b.id = p_bill_id
       AND b.embedding_f8 IS NOT NULL
  ),
  scored AS (
    SELECT c.id, c.state, c.bill_number, c.title, c.kratom_relevance,
           c.status, c.last_action_at,
           public.float8_cosine_sim(t.vec, c.embedding_f8) AS similarity
      FROM target t
      JOIN public.bills c
        ON c.id <> t.id
       AND c.active IS TRUE
       AND c.embedding_f8 IS NOT NULL
       AND c.kratom_relevance IN ('anti', 'pro')
       AND (p_include_same_state OR c.state <> t.state)
  )
  SELECT s.id, s.state, s.bill_number, s.title, s.kratom_relevance,
         s.status, s.last_action_at, s.similarity
    FROM scored s
   WHERE s.similarity >= p_min_similarity
   ORDER BY s.similarity DESC, s.id
   LIMIT GREATEST(COALESCE(p_limit, 5), 0);
$$;

COMMENT ON FUNCTION public.similar_bills(uuid, integer, double precision, boolean) IS
  'Top-N cross-state similar bills, scored in-database over bills.embedding_f8. '
  'Replaces shipping ~4 MB of jsonb embeddings per call to score in Node. '
  'SECURITY INVOKER on purpose — bills are public-read, so RLS gives the right '
  'answer per caller.';
