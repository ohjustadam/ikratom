-- 0131 — Vector embeddings on bills + state_briefings (Phase 3 D6).
--
-- Why: cross-state bill similarity is the killer query for kratom
-- policy intel. When NJ introduces a new KCPA, we want to instantly
-- see "87% match to TX HB 5 2024 — same coalition shopping a
-- template." Right now we can't query that. Pattern detection is
-- editorial guesswork.
--
-- Approach (matches migration 0019 for news_items): store embedding
-- as jsonb 768-dim float array. Ollama nomic-embed-text computes them
-- locally on the maintainer's desktop, free. No pgvector dependency
-- — at 467 active bills × 3 KB embedding ≈ 1.5 MB total, jsonb is
-- fine. We compute cosine similarity in application JS rather than
-- in SQL. If we ever need ANN at scale (10k+ bills) we can switch
-- to pgvector — the column type is straightforward to upgrade.
--
-- Same pattern reused for state_briefings — surfaces "states with
-- similar policy landscapes to this one" (NY <> NJ as kratom-
-- moderate Democratic states, TX <> MO <> ID as kratom-anti
-- conservative states with KCPA pushes).
--
-- Rollback:
--   ALTER TABLE public.bills DROP COLUMN IF EXISTS embedding;
--   ALTER TABLE public.bills DROP COLUMN IF EXISTS embedded_at;
--   ALTER TABLE public.state_briefings DROP COLUMN IF EXISTS embedding;
--   ALTER TABLE public.state_briefings DROP COLUMN IF EXISTS embedded_at;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS embedding jsonb,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

ALTER TABLE public.state_briefings
  ADD COLUMN IF NOT EXISTS embedding jsonb,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Partial indexes so "find unembedded rows" queries are fast.
CREATE INDEX IF NOT EXISTS bills_unembedded_idx
  ON public.bills (id)
  WHERE active = true AND embedding IS NULL;

CREATE INDEX IF NOT EXISTS state_briefings_unembedded_idx
  ON public.state_briefings (id)
  WHERE is_active = true AND embedding IS NULL;

COMMENT ON COLUMN public.bills.embedding IS
  'Vector embedding (jsonb 768-dim float array from Ollama nomic-embed-text). Used for cross-state bill similarity queries — see scripts/compute-bill-embeddings.mjs + src/lib/bill-similarity.ts.';
COMMENT ON COLUMN public.state_briefings.embedding IS
  'Vector embedding of body_md (jsonb 768-dim from nomic-embed-text). Used to find states with semantically-similar policy landscapes.';
