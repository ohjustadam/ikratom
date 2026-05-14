-- 0125 — Federal lobbying filings (LDA disclosures) intel pipeline
--
-- The kratom industry's federal influence shows up here, NOT in FEC
-- campaign contributions. AKA + GKC + BEA spend millions in
-- 501(c)(4)/(c)(6) money + retained DC lobbying firms (Upstream
-- Consulting, Valente & Associates, The Raben Group) to block bans
-- at FDA / DEA / Congress. 276+ kratom-mentioning filings exist in
-- the Senate LDA database — none of this shows in OpenFEC.
--
-- This table mirrors the Senate LDA REST API (lda.senate.gov/api/v1/
-- filings/) — public, no auth required. Synced via
-- scripts/sync-lda-kratom.mjs daily.
--
-- Per-legislator targeting limit: LDA filings disclose CHAMBER /
-- AGENCY contacted (House, Senate, DEA, FDA) but NOT specific
-- legislators. So we can surface aggregate intel ("AKA has lobbied
-- DEA + FDA + House on kratom 124 times since 2016") but not
-- "Senator X was personally lobbied on bill Y." The bill-level link
-- comes through the lobbying_activities.description free-text field
-- which often names specific bill numbers — that's a separate
-- enrichment phase.
--
-- Rollback: DROP TABLE public.lobbying_filings;

CREATE TABLE IF NOT EXISTS public.lobbying_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- LDA identity
  filing_uuid text NOT NULL UNIQUE,
  filing_type text,                                -- 'RR' (registration), 'Q1', 'Q2', etc.
  filing_type_display text,
  filing_year integer,
  filing_period text,                              -- 'first_quarter' etc.
  filing_period_display text,
  filing_document_url text,
  dt_posted timestamptz,

  -- Financials
  income numeric,                                  -- dollars (quarterly fee from client)
  expenses numeric,
  expenses_method text,                            -- 'a' or 'b' (LDA expense reporting method)

  -- Registrant (the lobbying firm)
  registrant_id integer,
  registrant_name text,
  registrant_city text,
  registrant_state text,

  -- Client (who hired them — for us, this is AKA / GKC / BEA / individual kratom companies)
  client_id integer,
  client_name text,
  client_state text,

  -- Activity-level aggregate (flattened for easy querying)
  -- Each lobbying_activities entry has issue_code, description,
  -- lobbyists[], government_entities[]. We denormalize the unique
  -- sets at the filing level.
  issue_codes text[] DEFAULT '{}',                 -- e.g. ['CSP', 'HCR', 'GOV']
  issue_descriptions text[] DEFAULT '{}',          -- free-text bill / issue descriptions
  government_entities text[] DEFAULT '{}',         -- e.g. ['U.S. House', 'DEA', 'FDA']
  lobbyists jsonb DEFAULT '[]'::jsonb,             -- [{first, last, covered_position}, ...]

  -- Tracking signal: was this filing flagged kratom-relevant?
  -- Currently always true since we only pull kratom-filtered filings,
  -- but kept for future widening (e.g. health-related filings from
  -- known kratom-industry clients).
  is_kratom_relevant boolean DEFAULT true,

  -- Raw API response — for future fields we don't extract yet
  raw_json jsonb,

  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lobbying_filings_year_idx
  ON public.lobbying_filings (filing_year DESC);
CREATE INDEX IF NOT EXISTS lobbying_filings_client_idx
  ON public.lobbying_filings (client_name);
CREATE INDEX IF NOT EXISTS lobbying_filings_registrant_idx
  ON public.lobbying_filings (registrant_name);
CREATE INDEX IF NOT EXISTS lobbying_filings_govt_entities_gin
  ON public.lobbying_filings USING gin (government_entities);
CREATE INDEX IF NOT EXISTS lobbying_filings_issue_codes_gin
  ON public.lobbying_filings USING gin (issue_codes);

-- Read-public RLS — these are PUBLIC RECORD filings, no PII concerns.
-- Admin-only writes via service role.
ALTER TABLE public.lobbying_filings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read lobbying filings" ON public.lobbying_filings;
CREATE POLICY "Public read lobbying filings"
  ON public.lobbying_filings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write lobbying filings" ON public.lobbying_filings;
CREATE POLICY "Admin write lobbying filings"
  ON public.lobbying_filings FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.lobbying_filings IS
  'Federal lobbying disclosures (Senate LDA) where kratom is mentioned in lobbying_activities. The kratom industry''s federal influence flows through here, not through FEC campaign contributions. ~276 known filings as of May 2026.';
