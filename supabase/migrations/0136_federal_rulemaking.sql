-- 0136 — Federal rulemaking intel via Regulations.gov.
--
-- Owner directive: build the war-machine command center using every
-- public-data tool we can pull from. After CourtListener (litigation),
-- this is the federal-agency-action layer. When FDA / DEA / HHS opens
-- a kratom rulemaking, our advocates need to see it the day it drops,
-- not weeks later via news. Regulations.gov is the canonical federal
-- public-comment portal — Notices of Proposed Rulemaking, Final Rules,
-- agency Notices, supporting documents, ALL public submissions.
--
-- Source: https://www.regulations.gov via api.regulations.gov v4.
-- Free API, ~1,000 requests/hour with a registered key (DEMO_KEY also
-- works, lower limit). Scrape script handles the no-key fallback.
--
-- As of 2026-05-14, 62 kratom-mentioning documents exist in
-- Regulations.gov. Examples:
--   - FDA NDI 1346 (Aug 2025): "NPI-001, a dried kratom leaf powder
--     from Johnson Foods Holding, LLC" — active new dietary ingredient
--     notification under FDA review
--   - 2024 FDA "Risk/Safety Considerations" agency information
--     collection (was withdrawn; still useful intel)
--   - Multiple FDA Complaints / enforcement-related items
--
-- The big-leverage rows are the OPEN-FOR-COMMENT ones: when commentEnd
-- is in the future, advocates can submit public comments and we should
-- be pushing that to every in-state user.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.federal_rulemaking;

CREATE TABLE IF NOT EXISTS public.federal_rulemaking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Regulations.gov identifiers (idempotent upsert key)
  rg_document_id text NOT NULL UNIQUE,        -- e.g. 'FDA-2023-N-1234-0001'
  rg_docket_id text,                          -- groups documents into a rulemaking
  rg_object_id text,                          -- another CL-style internal ID

  -- Agency + classification
  agency_id text NOT NULL,                    -- 'FDA' | 'DEA' | 'HHS' | 'FTC' | etc.
  document_type text,                         -- 'Notice' | 'Rule' | 'Proposed Rule' | 'Public Submission' | 'Supporting & Related Material' | 'Other'
  subtype text,                               -- agency-specific subclassification

  -- Content
  title text NOT NULL,
  abstract text,
  cfr_part text,                              -- e.g. '21 CFR 117' if applicable

  -- Dates
  posted_date timestamptz,                    -- when posted to regulations.gov
  comment_start_date date,                    -- when public comment period opens
  comment_end_date date,                      -- when it closes (the action deadline)
  effective_date date,                        -- for final rules

  -- Comment activity
  open_for_comment boolean DEFAULT false,     -- snapshot when scraper last ran
  comments_count integer DEFAULT 0,           -- Regulations.gov reports total submissions

  -- Public-facing references
  rg_url text,                                -- canonical URL on regulations.gov
  federal_register_url text,                  -- when relevant
  fr_doc_number text,                         -- Federal Register doc #

  -- Our classification
  kratom_relevance text DEFAULT 'pending'
    CHECK (kratom_relevance IN ('pending', 'confirmed', 'unrelated', 'tangential')),
  is_actionable boolean DEFAULT false,        -- has open comment period AND kratom-relevant

  -- Provenance
  source text NOT NULL DEFAULT 'regulations.gov',
  raw_json jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- "Show open comment periods" — the highest-leverage briefing query.
CREATE INDEX IF NOT EXISTS federal_rulemaking_open_idx
  ON public.federal_rulemaking (comment_end_date)
  WHERE open_for_comment = true;

-- "Order by recent" for the federal news section
CREATE INDEX IF NOT EXISTS federal_rulemaking_posted_idx
  ON public.federal_rulemaking (posted_date DESC NULLS LAST);

-- "All for this agency" admin filter
CREATE INDEX IF NOT EXISTS federal_rulemaking_agency_idx
  ON public.federal_rulemaking (agency_id);

-- =============================================================
-- RLS — public read (federal rules are public record), admin write
-- =============================================================
ALTER TABLE public.federal_rulemaking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read federal rulemaking" ON public.federal_rulemaking;
CREATE POLICY "Public read federal rulemaking"
  ON public.federal_rulemaking FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write federal rulemaking" ON public.federal_rulemaking;
CREATE POLICY "Admin write federal rulemaking"
  ON public.federal_rulemaking FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.federal_rulemaking IS
  'Federal kratom-mentioning rulemaking from Regulations.gov. FDA / DEA / HHS / FTC actions: NDI notifications, proposed rules, comment-period documents. Synced daily via scripts/sync-regulations-gov-kratom.mjs. Open-comment-period rows are the highest-leverage — surfaced in state briefings as a national CTA.';
