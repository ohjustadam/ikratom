-- 0254_similar_bills_rpc.sql
--
-- INTENT: stop shipping the entire bill embedding corpus out of Postgres just
-- to score it in JavaScript. Score in the database, return only the top N.
--
-- `src/lib/bill-similarity.ts` pulls every candidate bill WITH its 768-float
-- jsonb embedding and runs cosineSim() in Node. Measured today on the real
-- table, for the exact filter that function uses (active, embedded,
-- kratom_relevance in anti/pro):
--
--   263 candidate rows
--   9,223 bytes/row detoasted  ->  2,369 kB
--   4,096 kB serialized as JSON text, which is what PostgREST actually sends
--
-- So roughly 4 MB leaves the database per cache miss, and the function keeps
-- ten of those rows. The file's own comment still says "~1.5 MB" — that was
-- true when it was written; the corpus has since grown.
--
-- It is already cached (unstable_cache, 24h, per bill), and even so this was
-- the THIRD most expensive statement in the database: 1,812 seconds across
-- 4,928 calls (368 ms mean) over the 77-day pg_stat window. Supabase
-- compresses responses, so the billed egress is less than 4 MB per call — but
-- it is a large share of a ~167 MB/day sustainable budget for one page section,
-- and the fix removes essentially all of it: the RPC returns at most `p_limit`
-- rows of scalars, a few hundred bytes.
--
-- WHY NOT pgvector: the extension is available on this project but NOT
-- installed, and both embedding columns are jsonb. Converting means a new
-- column, a backfill, and a change to scripts/compute-bill-embeddings.mjs so
-- the writer populates both — worth doing eventually (it would also make this
-- an index lookup rather than a 263-row scan), but it is a bigger change than
-- the egress problem requires. This migration needs no extension, no column
-- change and no writer change, and is revertible by reverting one TS file.
--
-- SECURITY: deliberately SECURITY INVOKER (the default), not DEFINER. Bills are
-- public-read, so RLS gives the correct answer for every caller, and adding
-- another SECURITY DEFINER function would add a new Supabase advisor finding
-- against the documented 61-finding baseline for no benefit. search_path is
-- still pinned.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.similar_bills(uuid, integer, double precision, boolean);
--   DROP FUNCTION IF EXISTS public.jsonb_cosine_sim(jsonb, jsonb);
-- and revert src/lib/bill-similarity.ts to the client-side scoring path.

-- ---------------------------------------------------------------------------
-- Cosine similarity over two jsonb float arrays.
--
-- Mirrors cosineSim() in src/lib/bill-similarity.ts exactly, including its
-- degenerate cases: mismatched lengths and zero-norm vectors both return 0
-- rather than erroring or returning NULL, so a malformed embedding can never
-- take out a page render.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jsonb_cosine_sim(a jsonb, b jsonb)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
DECLARE
  v_dot double precision;
  v_na  double precision;
  v_nb  double precision;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0; END IF;
  IF jsonb_typeof(a) <> 'array' OR jsonb_typeof(b) <> 'array' THEN RETURN 0; END IF;
  IF jsonb_array_length(a) <> jsonb_array_length(b) THEN RETURN 0; END IF;

  SELECT sum(x * y), sum(x * x), sum(y * y)
    INTO v_dot, v_na, v_nb
    FROM (
      SELECT (ea.value #>> '{}')::double precision AS x,
             (eb.value #>> '{}')::double precision AS y
        FROM jsonb_array_elements(a) WITH ORDINALITY AS ea(value, ord)
        JOIN jsonb_array_elements(b) WITH ORDINALITY AS eb(value, ord)
          ON ea.ord = eb.ord
    ) z;

  IF v_na IS NULL OR v_nb IS NULL OR v_na = 0 OR v_nb = 0 THEN RETURN 0; END IF;
  RETURN v_dot / (sqrt(v_na) * sqrt(v_nb));
END;
$$;

COMMENT ON FUNCTION public.jsonb_cosine_sim(jsonb, jsonb) IS
  'Cosine similarity between two jsonb float arrays. Mirrors cosineSim() in '
  'src/lib/bill-similarity.ts; returns 0 (never NULL, never an error) for null '
  'input, non-arrays, length mismatch, or a zero vector.';

-- ---------------------------------------------------------------------------
-- Top-N similar bills for a target bill, scored in the database.
--
-- Candidate filter is identical to the one findSimilarBills() applied client
-- side: active, embedded, kratom_relevance in (anti, pro), not the target
-- itself, and — unless p_include_same_state — a different state. The 2000-row
-- cap that bounded the old payload is no longer needed: nothing leaves the
-- database except the rows that survive p_min_similarity and p_limit.
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
    SELECT b.id, b.state, b.embedding
      FROM public.bills b
     WHERE b.id = p_bill_id
       AND b.embedding IS NOT NULL
       AND jsonb_typeof(b.embedding) = 'array'
  ),
  -- Scored in a subquery so jsonb_cosine_sim is evaluated once per candidate
  -- rather than once for the projection and again for the threshold.
  scored AS (
    SELECT c.id, c.state, c.bill_number, c.title, c.kratom_relevance,
           c.status, c.last_action_at,
           public.jsonb_cosine_sim(t.embedding, c.embedding) AS similarity
      FROM target t
      JOIN public.bills c
        ON c.id <> t.id
       AND c.active IS TRUE
       AND c.embedding IS NOT NULL
       AND jsonb_typeof(c.embedding) = 'array'
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
  'Top-N cross-state similar bills, scored in-database. Replaces shipping ~4 MB '
  'of jsonb embeddings per call to score in Node (was the 3rd most expensive '
  'statement in the DB: 1,812s / 4,928 calls). SECURITY INVOKER on purpose — '
  'bills are public-read, so RLS gives the right answer per caller.';
