-- 0134 — Court litigation intel (the second battlefield after legislatures).
--
-- Owner directive on free public data sources we can plug into the
-- automated war machine: court records are the gap we currently have
-- zero visibility into. AKA + GKC litigate against state bans (e.g.
-- AKA v. Tennessee, AKA v. Indiana). Federal court opinions
-- mentioning kratom exist for 31+ cases per CourtListener's index.
-- Without this layer, we hear about a state ban in the news but miss
-- the follow-up legal challenge that determines whether the ban
-- actually sticks.
--
-- Source: CourtListener (https://www.courtlistener.com) by the Free
-- Law Project. Free unlimited API, no key required for reasonable
-- use. They aggregate federal + state court opinions and dockets;
-- their search endpoint returns kratom-mentioning cases with rich
-- metadata (court, judges, citation, opinion text snippet).
--
-- We capture two kinds of rows:
--   - Opinions: published case decisions. The 31 we know about today.
--     Search ranks by date filed; we'll keep the freshest 200.
--   - Dockets: pending cases (filings, not yet decided). Harder to
--     query — CourtListener's docket-search has different ranking.
--     Phase 2.
--
-- For Phase 1 of this table, we only store opinion rows. The schema
-- has docket_id from CourtListener so Phase 2 can extend without a
-- migration: just add rows with case_kind='docket'.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.court_cases;

CREATE TABLE IF NOT EXISTS public.court_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CourtListener identifiers (stable, idempotent upsert key)
  cl_cluster_id bigint,                       -- the opinion cluster ID
  cl_docket_id bigint,                        -- the docket ID
  cl_url text,                                -- absolute_url on CourtListener
  case_kind text NOT NULL DEFAULT 'opinion'
    CHECK (case_kind IN ('opinion', 'docket', 'recap', 'oral_arg')),

  -- Case identity
  case_name text NOT NULL,                    -- 'State v. Seymour' / 'AKA v. Tennessee'
  case_name_full text,                        -- if longer official form exists
  docket_number text,                         -- '2024-1658'
  citation text[] DEFAULT '{}',               -- ['2026 Ohio 1249']

  -- Court + jurisdiction
  court_name text,                            -- 'Ohio Supreme Court'
  court_id text,                              -- CourtListener's slug, e.g. 'ohio', 'tenn'
  state text,                                 -- 2-letter when state-court; NULL for federal
  jurisdiction text,                          -- 'F' (federal) | 'FB' | 'S' (state-supreme) | 'SA' | etc.

  -- Timing
  date_filed date,
  date_argued date,
  date_reargued date,

  -- Decision metadata
  judge text,                                  -- author judge name (free-text)
  status text,                                 -- 'Published' | 'Unpublished' | 'Errata' | ...
  cite_count integer,                          -- how often this opinion is cited (rough authority signal)

  -- Content snippets
  syllabus text,                               -- court's own summary
  snippet text,                                -- ~200 chars around the kratom mention (we extract)

  -- Substantive classification (we set these from our pipeline, not CL)
  kratom_relevance text DEFAULT 'pending'
    CHECK (kratom_relevance IN ('pending', 'confirmed', 'unrelated', 'tangential')),
  parties_industry boolean DEFAULT false,      -- e.g. AKA / GKC as a named party
  challenged_law text,                         -- if challenging a specific state law

  -- Provenance + raw response
  source text NOT NULL DEFAULT 'courtlistener',
  raw_json jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),

  -- Idempotent upsert key. We prefer cl_cluster_id when present
  -- (opinions); fall back to docket_id (Phase 2). Both can be NULL
  -- for manually-entered editorial cases, so the unique constraint
  -- allows NULLs but blocks duplicates of real CL records.
  UNIQUE(cl_cluster_id)
);

CREATE INDEX IF NOT EXISTS court_cases_date_filed_idx
  ON public.court_cases (date_filed DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS court_cases_state_idx
  ON public.court_cases (state)
  WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS court_cases_industry_party_idx
  ON public.court_cases (date_filed DESC)
  WHERE parties_industry = true;

-- =============================================================
-- RLS — public read (court records are public), admin write
-- =============================================================
ALTER TABLE public.court_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read court cases" ON public.court_cases;
CREATE POLICY "Public read court cases"
  ON public.court_cases FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write court cases" ON public.court_cases;
CREATE POLICY "Admin write court cases"
  ON public.court_cases FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.court_cases IS
  'Kratom-related court cases from CourtListener / Free Law Project. Federal + state opinions where kratom is mentioned. Phase 1 = opinion search; Phase 2 will add pending dockets. Synced daily via scripts/sync-courtlistener-kratom.mjs.';
