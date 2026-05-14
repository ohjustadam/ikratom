-- 0127 — Per-legislator news mentions index (Phase 3 D4 Phase 1).
--
-- Why: we have 4,256 news_items tagged by state but no per-legislator
-- index. The briefing page currently shows kratom news at the STATE
-- level ("here's what's in NY news") but can't show ("here's what's
-- in news ABOUT Sen. X specifically"). This table fills that gap.
--
-- Method: name-pattern regex match against news title + summary +
-- body_extract_excerpt. Phase 1 is exact-match only — see
-- scripts/index-legislator-news-mentions.mjs for the patterns. Phase 2
-- (AI-quote extraction) is intentionally deferred; per
-- docs/INTEL_PHASE_3_PLAN.md, Phase 1 will populate sparsely since
-- current news scrape is kratom-policy-focused not legislator-focused.
-- Sparsely is fine — when a match exists it's high-signal.
--
-- Idempotent: UNIQUE on (legislator_id, news_item_id, matched_field).
-- A name appearing in both title and summary creates two rows; the
-- briefing render dedupes by news_item_id.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.legislator_news_mentions;

CREATE TABLE IF NOT EXISTS public.legislator_news_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legislator_id uuid NOT NULL REFERENCES public.legislators(id) ON DELETE CASCADE,
  news_item_id uuid NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,

  -- How confident we are this is THIS legislator, not someone else with
  -- the same name in another state. State-scoping the indexer keeps
  -- this high; the field exists for Phase 2 when we accept fuzzy matches.
  --   'exact_full_name'     — "Senator John Smith"
  --   'title_lastname'      — "Sen. Smith" in same-state article
  --   'lastname_role_state' — "Rep. Smith" disambiguated by role + state
  match_confidence text NOT NULL DEFAULT 'exact_full_name',

  -- Which field the match landed in (audit + render priority)
  matched_field text NOT NULL,  -- 'title' | 'summary' | 'body'

  -- ~120 char snippet around the match for the briefing render.
  -- "…on Tuesday, Sen. John Smith said the new kratom bill was a…"
  mention_context text,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(legislator_id, news_item_id, matched_field)
);

-- "Show all mentions of Sen. X, newest first" — the briefing query.
CREATE INDEX IF NOT EXISTS legislator_news_mentions_legislator_idx
  ON public.legislator_news_mentions (legislator_id);

-- "Who's mentioned in this article?" — admin/audit query.
CREATE INDEX IF NOT EXISTS legislator_news_mentions_news_idx
  ON public.legislator_news_mentions (news_item_id);

-- =============================================================
-- RLS — public read (news is public), admin write
-- =============================================================
ALTER TABLE public.legislator_news_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read legislator news mentions" ON public.legislator_news_mentions;
CREATE POLICY "Public read legislator news mentions"
  ON public.legislator_news_mentions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write legislator news mentions" ON public.legislator_news_mentions;
CREATE POLICY "Admin write legislator news mentions"
  ON public.legislator_news_mentions FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.legislator_news_mentions IS
  'Per-legislator name-match index over news_items. Populated by scripts/index-legislator-news-mentions.mjs. Phase 1 = exact match only; Phase 2 will add AI quote extraction.';
