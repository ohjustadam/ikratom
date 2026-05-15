-- 0137 — Federal awards (contracts + grants) via USAspending.gov.
--
-- Owner directive on building the war-machine command center from
-- every public-data source. After CourtListener (litigation) and
-- Regulations.gov (rulemaking), this is the federal-money-flow
-- layer. Surfaces:
--
--   - **Contracts**: federal agencies paying private companies for
--     kratom-related work. The Aug-2025 live probe surfaced
--     $2.37M from FDA to Altasciences Clinical Kansas for "Dose-
--     finding study of kratom alkaloids pilot." That's research
--     that will likely shape future FDA scheduling decisions —
--     we need to see it the day it gets awarded.
--
--   - **Grants**: federal assistance awards (NIH research grants,
--     SAMHSA prevention grants, etc.). When NIDA funds an
--     anti-kratom academic study, advocates need to know who's
--     getting paid and what conclusions to expect.
--
-- Source: api.usaspending.gov v2. Free, no key required, generous
-- rate limit (~2,500/min). The /search/spending_by_award/ POST
-- endpoint takes keyword + award_type_codes and returns rich
-- recipient/award metadata.
--
-- Award type codes (subset we care about):
--   A,B,C,D = procurement contracts (FDA paying a clinical research
--              firm = code A or D)
--   02..11  = financial assistance (grants, cooperative agreements,
--              loans, insurance)
--   IDV_*   = indefinite delivery vehicles (long-term agency
--              contracts; check these for ongoing kratom research)
--
-- Rollback:
--   DROP TABLE IF EXISTS public.federal_awards;

CREATE TABLE IF NOT EXISTS public.federal_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- USAspending identifiers
  usa_award_id text NOT NULL UNIQUE,            -- canonical award ID
  usa_recipient_id text,                         -- recipient unique ID
  usa_url text,                                  -- public deep-link

  -- Classification
  award_type text,                               -- 'A' / 'B' / '02' / etc.
  award_type_label text,                         -- 'Contract' | 'Grant' | 'Cooperative Agreement' etc.
  category text                                  -- 'contract' | 'grant' (high-level bucket we set)
    CHECK (category IN ('contract', 'grant', 'idv', 'loan', 'other')),

  -- Money
  amount numeric,                                -- award_amount in dollars
  amount_funded numeric,                         -- federal_action_obligation

  -- Parties
  awarding_agency text,                          -- 'Department of Health and Human Services'
  awarding_sub_agency text,                      -- 'Food and Drug Administration' / 'NIH'
  recipient_name text NOT NULL,
  recipient_state text,                          -- 2-letter where present
  recipient_zip text,

  -- Period of performance
  start_date date,
  end_date date,

  -- Description
  description text,                              -- often the actual project title
  cfda_number text,                              -- Catalog of Federal Domestic Assistance
  naics_code text,                               -- for contracts
  psc_code text,                                 -- Product Service Code (contracts)

  -- Our analysis
  kratom_relevance text DEFAULT 'pending'
    CHECK (kratom_relevance IN ('pending', 'confirmed', 'tangential', 'unrelated')),
  is_research boolean DEFAULT false,             -- flagged when desc/agency suggests research

  -- Provenance
  source text NOT NULL DEFAULT 'usaspending',
  raw_json jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS federal_awards_recipient_idx
  ON public.federal_awards (recipient_name);
CREATE INDEX IF NOT EXISTS federal_awards_agency_idx
  ON public.federal_awards (awarding_sub_agency, awarding_agency);
CREATE INDEX IF NOT EXISTS federal_awards_amount_idx
  ON public.federal_awards (amount DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS federal_awards_recipient_state_idx
  ON public.federal_awards (recipient_state)
  WHERE recipient_state IS NOT NULL;

-- =============================================================
-- RLS — public read (federal spending is public), admin write
-- =============================================================
ALTER TABLE public.federal_awards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read federal awards" ON public.federal_awards;
CREATE POLICY "Public read federal awards"
  ON public.federal_awards FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write federal awards" ON public.federal_awards;
CREATE POLICY "Admin write federal awards"
  ON public.federal_awards FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.federal_awards IS
  'Federal grants + contracts mentioning kratom from USAspending.gov. The federal-money-flow layer of the intel network — surfaces who is being paid by which agency for kratom-related work. As of first live probe (2026-05-14): $2.37M FDA contract to Altasciences Clinical Kansas for kratom alkaloid dose-finding study.';
