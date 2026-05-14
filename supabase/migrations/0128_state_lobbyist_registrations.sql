-- 0128 — State lobbyist registrations (Phase 3 D2 pilot, starting with Utah).
--
-- The kratom industry's STATE-level political activity is the larger
-- half of its political footprint — bigger than federal lobbying
-- (which is captured in lobbying_filings via Senate LDA). State
-- lobbying disclosures live in 50 different registries with different
-- formats. We start with Utah because:
--
--   1. Utah hosts the documented Bramble + Haddow + 2026 Word of
--      Wisdom incident — AKA influence concentrated there.
--   2. Utah's lobbyist registry at lobbyist.utah.gov is fully public,
--      HTML-table-based, no auth, no per-page rate limit.
--   3. AKA already has SIX active registered lobbyists in Utah
--      (Haddow, Holton, Stokes, Clyde, Salmon, White) — a January 2026
--      hiring burst that proves there's intel surface here.
--
-- This table captures the lobbyist↔principal relationship layer:
-- "who is registered to lobby for whom, since when, until when." It
-- does NOT yet capture dollar amounts — those live in the per-state
-- "Summary of Lobbyist Reports" page and require POST scraping; Phase
-- 2 work.
--
-- Schema is intentionally state-agnostic so we can extend to FL, NJ,
-- CA, TX, MI, OH after Utah is green.
--
-- Rollback: DROP TABLE public.state_lobbyist_registrations;

CREATE TABLE IF NOT EXISTS public.state_lobbyist_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Always 2-letter state code; lets us cross-reference with bills,
  -- legislators, news_items by state.
  state text NOT NULL,

  -- Lobbyist identity. Format varies by source ("Last, First" in Utah,
  -- "First Last" in FL). We normalize on the scraper side to "First
  -- Last" before storing; preserves searchability across states.
  lobbyist_name text NOT NULL,
  -- Optional honorific / suffix preserved as a free-text field
  -- (some Utah registrations duplicate a person as both "Principal"
  -- (the lobbyist registered for a direct-paid client) and "Business"
  -- (the lobbyist registered as a billable firm) — we want to keep
  -- both records distinct, hence in the UNIQUE constraint).
  registration_type text,         -- 'Principal' | 'Business' | state-specific

  -- The hiring entity (e.g. "American Kratom Association",
  -- "Botanic Tonics", "Center For Plant Science and Health").
  principal_name text NOT NULL,
  principal_address text,
  principal_city text,
  principal_state text,
  principal_zip text,
  principal_phone text,

  -- Dates as recorded in the source. start_date NULL is allowed
  -- but rare — most state registries require it.
  start_date date,
  end_date date,                  -- NULL = currently active

  -- Provenance — every row points to the page it came from so admins
  -- can verify.
  source_name text NOT NULL DEFAULT 'utah-lobbyist-gov',
  source_url text NOT NULL,

  -- Whether the scraper's keyword filter flagged this row as
  -- kratom-relevant. We store ALL rows (so we can re-classify later
  -- without re-scraping) but the briefing only renders ones flagged
  -- true.
  is_kratom_relevant boolean NOT NULL DEFAULT false,

  -- Optional cross-reference to industry actors registry (the static
  -- TS file). Set by an enrichment pass; NULL means we don't have a
  -- canonical actor for this lobbyist yet — candidate for editorial
  -- expansion of kratom-industry-actors.ts.
  actor_id text,

  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- A registration is uniquely identified by (state, lobbyist, principal,
  -- start_date) across the major sources. Re-running the scraper updates
  -- end_date / scraped_at via ON CONFLICT.
  UNIQUE(state, lobbyist_name, principal_name, start_date)
);

CREATE INDEX IF NOT EXISTS state_lobbyist_registrations_state_idx
  ON public.state_lobbyist_registrations (state);
CREATE INDEX IF NOT EXISTS state_lobbyist_registrations_principal_idx
  ON public.state_lobbyist_registrations (principal_name);
CREATE INDEX IF NOT EXISTS state_lobbyist_registrations_lobbyist_idx
  ON public.state_lobbyist_registrations (lobbyist_name);
-- "Active in state X" — the briefing query.
CREATE INDEX IF NOT EXISTS state_lobbyist_registrations_active_idx
  ON public.state_lobbyist_registrations (state)
  WHERE end_date IS NULL AND is_kratom_relevant = true;

-- =============================================================
-- RLS — public read (lobbying registrations are public record),
-- admin write
-- =============================================================
ALTER TABLE public.state_lobbyist_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read state lobbyist registrations" ON public.state_lobbyist_registrations;
CREATE POLICY "Public read state lobbyist registrations"
  ON public.state_lobbyist_registrations FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write state lobbyist registrations" ON public.state_lobbyist_registrations;
CREATE POLICY "Admin write state lobbyist registrations"
  ON public.state_lobbyist_registrations FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.state_lobbyist_registrations IS
  'State-level lobbyist-principal registrations. Utah pilot (2026 Q2). Source: lobbyist.utah.gov LobbyistByPrincipal page. Extend to other states by adding source-specific scrapers that write the same schema.';
