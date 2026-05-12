-- 0112: Intel foundations for state-level kratom advocacy.
--
-- Bridges the gap between "we have legislators + bills" (what we have)
-- and "we have a complete tactical picture of how to do field work in
-- this state" (CIA/FBI-grade per the owner). Adds four tables that
-- become required reading for any state briefing:
--
--   state_capital_info       Where the capital is, when in session, how
--                            to request meetings, public-comment URLs.
--                            One row per state. Hand-curated; can be
--                            AI-assisted via web search but admin-verified.
--
--   bill_sponsors            Per-bill primary/cosponsor list. Sourced from
--                            OpenStates + LegiScan responses we already
--                            pull but currently throw away. Enables
--                            "who introduced this and who else signed
--                            on" answers in briefings + per-legislator
--                            kratom-history queries.
--
--   legislator_committees    Which committees each legislator sits on
--                            (with chair/vice/member role). Scraped per
--                            state — most legislative websites publish
--                            this in machine-readable form. Critical for
--                            advocacy: bills die in committees, so the
--                            chairs of Health / Codes / Consumer Affairs
--                            are the actual decision-makers on kratom bills.
--
--   legislator_kratom_stance Admin-curated champion/hostile/neutral flag
--                            with rationale. Surfaces "talk to these 3
--                            first, avoid wasting time on those 2" in
--                            briefings. Editable via /admin/legislators.
--
-- All four are designed so the briefing generator can JOIN them into
-- the per-state data payload — schema applies to NY today, every other
-- state when the owner unblocks them via states.briefing_gen_enabled.
--
-- Rollback:
--   DROP TABLE IF EXISTS legislator_kratom_stance;
--   DROP TABLE IF EXISTS legislator_committees;
--   DROP TABLE IF EXISTS bill_sponsors;
--   DROP TABLE IF EXISTS state_capital_info;

-- =============================================================
-- 1. state_capital_info — per-state operational metadata
-- =============================================================
CREATE TABLE IF NOT EXISTS state_capital_info (
  state text PRIMARY KEY,                           -- 2-letter code
  capital_city text,
  capital_address text,                              -- street address of legislative building
  legislature_url text,                              -- main legislature website
  session_url text,                                  -- session schedule page
  current_session_id text,                           -- e.g. "2025-2026"
  current_session_start date,
  current_session_end date,
  in_session_now boolean,                            -- updated by cron
  public_comment_url text,                           -- how to submit written testimony
  hearing_schedule_url text,
  visitor_info_url text,                             -- parking, security, dress code
  staff_directory_url text,                          -- who to call to schedule a meeting
  notes_md text,                                     -- admin field-work notes (security entrance, where to park, etc.)
  last_updated_at timestamptz DEFAULT now(),
  last_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE state_capital_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read state capital info" ON state_capital_info;
CREATE POLICY "Public read state capital info"
  ON state_capital_info FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write state capital info" ON state_capital_info;
CREATE POLICY "Admin write state capital info"
  ON state_capital_info FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE state_capital_info IS
  'Per-state operational metadata for field-work briefings: capital address, session dates, public-comment URLs, scheduling contacts. Hand-curated; surfaces in briefings + on /briefings/state/[code].';

-- Seed NY (owner''s focus state)
INSERT INTO state_capital_info (
  state, capital_city, capital_address, legislature_url, session_url,
  current_session_id, current_session_start, current_session_end,
  public_comment_url, hearing_schedule_url, visitor_info_url, staff_directory_url,
  notes_md
) VALUES (
  'NY',
  'Albany',
  'New York State Capitol, State Street, Albany, NY 12224',
  'https://www.nysenate.gov/',
  'https://www.nysenate.gov/calendar',
  '2025-2026',
  '2026-01-08',
  '2026-06-19',
  'https://www.nyassembly.gov/leg/?sh=email-rep',
  'https://www.nysenate.gov/calendar',
  'https://www.nysenate.gov/visiting',
  'https://www.nysenate.gov/senators-staff',
  $$
**Visiting Albany — field-work notes:**
- Security at the Capitol West entrance; clear bag policy in chambers.
- LOB (Legislative Office Building) connected via tunnel from Capitol.
- Best parking: State St. Garage (paid) or Empire State Plaza lot.
- Standard meeting protocol: contact the legislator's scheduler (LOB staff
  directory) 2-3 weeks ahead. Walk-ins to district offices possible but
  rarely productive.
- Public hearings are listed on the Senate/Assembly calendars 1 week+ ahead.
  Sign up to testify via the committee clerk — written testimony usually
  accepted up to 24h after the hearing.
- Codes Committee (Senate) + Health Committee (Assembly) are the primary
  battlegrounds for kratom legislation. Watch for joint hearings.
  $$
)
ON CONFLICT (state) DO NOTHING;

-- =============================================================
-- 2. bill_sponsors — already exists from migration 0032 with schema:
--    (id, bill_id, legislator_id, name, classification, party, district)
-- Re-used as-is; sync-bill-sponsors.mjs writes against that schema.
-- (Earlier draft of this migration tried to redefine columns —
-- removed to avoid drift.)
-- =============================================================

-- =============================================================
-- 3. legislator_committees — committee assignments + roles
-- =============================================================
CREATE TABLE IF NOT EXISTS legislator_committees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legislator_id uuid NOT NULL REFERENCES legislators(id) ON DELETE CASCADE,
  committee_name text NOT NULL,                      -- e.g. "Senate Health", "Assembly Codes"
  chamber text,                                       -- 'senate' | 'house' | 'joint'
  role text NOT NULL DEFAULT 'member',                -- 'chair' | 'vice_chair' | 'ranking_member' | 'member'
  is_kratom_relevant boolean DEFAULT false,           -- flagged for committees that handle kratom bills
  session_id text,                                    -- which session this assignment is for
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(legislator_id, committee_name, session_id)
);

CREATE INDEX IF NOT EXISTS ix_legislator_committees_leg ON legislator_committees(legislator_id);
CREATE INDEX IF NOT EXISTS ix_legislator_committees_kratom
  ON legislator_committees(legislator_id) WHERE is_kratom_relevant = true;

ALTER TABLE legislator_committees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read legislator committees" ON legislator_committees;
CREATE POLICY "Public read legislator committees"
  ON legislator_committees FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write legislator committees" ON legislator_committees;
CREATE POLICY "Admin write legislator committees"
  ON legislator_committees FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE legislator_committees IS
  'Committee assignments per legislator. Chairs + ranking members of kratom-relevant committees (Health, Codes, Consumer Affairs, Public Safety, etc.) are the actual decision-makers. is_kratom_relevant = true filters to ones admin has flagged as battlegrounds.';

-- =============================================================
-- 4. legislator_kratom_stance — champion / hostile / neutral
-- =============================================================
CREATE TABLE IF NOT EXISTS legislator_kratom_stance (
  legislator_id uuid PRIMARY KEY REFERENCES legislators(id) ON DELETE CASCADE,
  stance text NOT NULL CHECK (stance IN ('champion', 'sympathetic', 'neutral', 'hostile', 'unknown')),
  -- Markdown — admin can write a paragraph of context (history with kratom,
  -- public statements, sponsorship pattern). Surfaces verbatim in briefings.
  rationale_md text,
  last_evidence_url text,                            -- link to bill / news / statement supporting the stance
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE legislator_kratom_stance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read legislator stance" ON legislator_kratom_stance;
CREATE POLICY "Public read legislator stance"
  ON legislator_kratom_stance FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write legislator stance" ON legislator_kratom_stance;
CREATE POLICY "Admin write legislator stance"
  ON legislator_kratom_stance FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE legislator_kratom_stance IS
  'Curated per-legislator stance flag. Powers "who are our champions in this state, who are the hostile ones" sections in briefings. Set by admin via /admin/legislators (one-time per legislator; updateable as positions evolve).';
