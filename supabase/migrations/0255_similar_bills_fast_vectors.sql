-- 0255_similar_bills_fast_vectors.sql
--
-- INTENT: keep 0254's egress win, remove the latency it cost.
--
-- 0254 moved similar-bill scoring into the database and cut the payload by
-- 99.965% (284.40 MB -> 0.10 MB across an 80-call comparison). Verified
-- identical: 0 mismatches, ids and scores agreeing to 1e-9 with the JS path.
--
-- But it was SLOWER: 962 ms/call client-side scoring -> 1907 ms/call in SQL.
-- Two reasons, both in jsonb_cosine_sim:
--
--   1. It walked both vectors with jsonb_array_elements + `#>> '{}'`, so every
--      one of the 768 floats cost a jsonb scalar extraction and a text parse.
--   2. It took the TARGET as jsonb, so the target's 768 floats were re-parsed
--      once per candidate — 263 times per call, entirely redundantly.
--
-- Fix: parse each jsonb vector to a real float8[] ONCE, and compute the dot
-- product and both norms with a two-array `unnest(a, b)` zip, which is a tight
-- internal loop rather than per-element jsonb lookups. The conversion itself is
-- a single array-literal parse (`translate(v::text, '[]', '{}')::float8[]`)
-- instead of 768 individual ones. similar_bills() now parses the target once in
-- a CTE and each candidate once, so parses drop from 2*263 to 1+263.
--
-- jsonb_cosine_sim(jsonb, jsonb) is KEPT as a thin wrapper, with its contract
-- unchanged, because it documents the mirror of cosineSim() in
-- src/lib/bill-similarity.ts and may have other callers later. It is now fast
-- too, since it delegates.
--
-- DEFENSIVE CONTRACT PRESERVED: every one of these returns 0 — never NULL,
-- never an exception — for null input, a non-array, a length mismatch, a zero
-- vector, or an element that will not parse as a float. A malformed embedding
-- must not be able to take out a bill page render, and the array-literal cast
-- can raise where the old per-element path merely yielded NULL, so the cast is
-- wrapped in its own exception block.
--
-- ROLLBACK: 0254's definitions are still valid; re-apply that file's two
-- CREATE OR REPLACE blocks to return to the slower-but-equivalent version, or
--   DROP FUNCTION IF EXISTS public.similar_bills(uuid, integer, double precision, boolean);
--   DROP FUNCTION IF EXISTS public.jsonb_cosine_sim(jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.float8_cosine_sim(double precision[], double precision[]);
--   DROP FUNCTION IF EXISTS public.jsonb_to_float8_array(jsonb);
-- to remove the feature entirely.

-- ---------------------------------------------------------------------------
-- jsonb float array -> float8[], in one parse. Returns NULL (not an error) for
-- anything that is not a parseable flat array of numbers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jsonb_to_float8_array(v jsonb)
RETURNS double precision[]
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'array' THEN RETURN NULL; END IF;
  BEGIN
    -- A flat JSON number array differs from a Postgres array literal only in
    -- its brackets, so this is a single array parse rather than 768 jsonb
    -- scalar extractions.
    RETURN translate(v::text, '[]', '{}')::double precision[];
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION public.jsonb_to_float8_array(jsonb) IS
  'Parses a flat jsonb number array into float8[] in a single cast. NULL for '
  'null / non-array / unparseable input — never raises.';

-- ---------------------------------------------------------------------------
-- Cosine similarity over two float8[] vectors.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.float8_cosine_sim(a double precision[], b double precision[])
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
  IF array_length(a, 1) IS DISTINCT FROM array_length(b, 1) THEN RETURN 0; END IF;

  SELECT sum(u.x * u.y), sum(u.x * u.x), sum(u.y * u.y)
    INTO v_dot, v_na, v_nb
    FROM unnest(a, b) AS u(x, y);

  IF v_na IS NULL OR v_nb IS NULL OR v_na = 0 OR v_nb = 0 THEN RETURN 0; END IF;
  RETURN v_dot / (sqrt(v_na) * sqrt(v_nb));
END;
$$;

COMMENT ON FUNCTION public.float8_cosine_sim(double precision[], double precision[]) IS
  'Cosine similarity over two float8[] using a two-array unnest zip. Returns 0 '
  '(never NULL, never an error) on null, length mismatch, or a zero vector.';

-- ---------------------------------------------------------------------------
-- Thin wrapper, contract identical to 0254 and to cosineSim() in TS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jsonb_cosine_sim(a jsonb, b jsonb)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT public.float8_cosine_sim(
           public.jsonb_to_float8_array(a),
           public.jsonb_to_float8_array(b)
         );
$$;

COMMENT ON FUNCTION public.jsonb_cosine_sim(jsonb, jsonb) IS
  'Cosine similarity between two jsonb float arrays. Mirrors cosineSim() in '
  'src/lib/bill-similarity.ts; returns 0 (never NULL, never an error) for null '
  'input, non-arrays, length mismatch, or a zero vector. Delegates to '
  'float8_cosine_sim after a single-parse conversion.';

-- ---------------------------------------------------------------------------
-- Top-N similar bills. Same candidate filter and same results as 0254; the
-- target vector is now parsed once instead of once per candidate.
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
    SELECT b.id, b.state, public.jsonb_to_float8_array(b.embedding) AS vec
      FROM public.bills b
     WHERE b.id = p_bill_id
       AND b.embedding IS NOT NULL
  ),
  scored AS (
    SELECT c.id, c.state, c.bill_number, c.title, c.kratom_relevance,
           c.status, c.last_action_at,
           public.float8_cosine_sim(
             t.vec, public.jsonb_to_float8_array(c.embedding)
           ) AS similarity
      FROM target t
      JOIN public.bills c
        ON c.id <> t.id
       AND c.active IS TRUE
       AND c.embedding IS NOT NULL
       AND c.kratom_relevance IN ('anti', 'pro')
       AND (p_include_same_state OR c.state <> t.state)
     WHERE t.vec IS NOT NULL
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
  'of jsonb embeddings per call to score in Node. SECURITY INVOKER on purpose — '
  'bills are public-read, so RLS gives the right answer per caller.';
