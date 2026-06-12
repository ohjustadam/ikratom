-- 0199: Election dates — geofenced civic calendar layer (#19).
--
-- Adds upcoming US election dates (federal general + per-state primaries and
-- runoffs) to the policy calendar (/calendar + /calendar/feed.ics). Geofence:
-- national-scope rows show to EVERYONE; state-scope rows show only to users
-- whose profiles.state matches (or who explicitly filter ?state=XX). Anon
-- users see national items + a 'set your state' nudge.
--
-- Real-data-only: seeded from NCSL '2026 State Primary Election Dates'
-- (authoritative, citable) + the deterministic federal general election date.
-- Kept fresh by scripts/sync-elections.mjs (weekly self-gate). NCSL is a
-- keyless public HTML scrape — free-tier compliant, no paid API.
--
-- Rollback:
--   DROP TABLE IF EXISTS election_dates;

CREATE TABLE IF NOT EXISTS election_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Geofence scope: national → everyone; state/local → matching profiles.state.
  scope text NOT NULL DEFAULT 'state'
    CHECK (scope IN ('national', 'state', 'local')),
  state text,                                  -- 2-letter code; NULL for national
  locality text,                               -- 'City, ST'; NULL unless local
  election_type text NOT NULL
    CHECK (election_type IN ('general', 'primary', 'primary_runoff', 'special', 'registration_deadline')),
  title text NOT NULL,                         -- human label, e.g. 'Oklahoma 2026 Primary'
  election_date date NOT NULL,                 -- the date (rendered all-day)
  registration_deadline date,                  -- nullable; enriched later (Civic)
  -- Provenance
  source text NOT NULL DEFAULT 'manual',       -- 'ncsl' / 'federal_seed' / 'google_civic' / 'manual'
  source_url text,
  ocd_division_id text,                        -- OCD id join key (Civic / OpenStates)
  -- Moderation: authoritative gov sources seed as approved; admin can override.
  moderation_status text NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending_review', 'approved', 'rejected', 'archived')),
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Natural-key dedupe (COALESCE form works on every PG version; NULLs collapse
-- so national rows dedupe too). sync-elections.mjs matches on this key
-- (select-then-update/insert) so weekly re-syncs never duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS ux_election_dates_natural
  ON election_dates (scope, COALESCE(state, ''), COALESCE(locality, ''), election_type, election_date);

CREATE INDEX IF NOT EXISTS ix_election_dates_upcoming
  ON election_dates (election_date)
  WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS ix_election_dates_state
  ON election_dates (state, election_date)
  WHERE moderation_status = 'approved';

ALTER TABLE election_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read approved elections" ON election_dates;
CREATE POLICY "Public read approved elections"
  ON election_dates FOR SELECT
  USING (moderation_status = 'approved');

DROP POLICY IF EXISTS "Admin all elections" ON election_dates;
CREATE POLICY "Admin all elections"
  ON election_dates FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE election_dates IS
  'US election dates (federal general + per-state primaries/runoffs) for the geofenced policy calendar. Seeded from NCSL + the federal general date; refreshed weekly by scripts/sync-elections.mjs. national-scope rows show to everyone; state-scope rows geofence to profiles.state.';

-- Initial seed (real, citable). Guarded so re-running the migration is a no-op
-- once seeded — the weekly sync owns freshness thereafter.
INSERT INTO election_dates (scope, state, locality, election_type, title, election_date, source, source_url)
SELECT v.scope, v.state, v.locality, v.election_type, v.title, v.election_date, v.source, v.source_url
FROM (VALUES
('national', null::text, null::text, 'general', '2026 U.S. General Election', '2026-11-03', 'federal_seed', 'https://www.eac.gov'),
('state', 'AL', null, 'primary', 'Alabama 2026 Primary — most offices', '2026-05-19', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'AL', null, 'primary_runoff', 'Alabama 2026 Primary Runoff — most offices', '2026-06-16', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'AL', null, 'primary', 'Alabama 2026 Primary — certain U.S. House districts', '2026-08-11', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'AK', null, 'primary', 'Alaska 2026 Primary', '2026-08-18', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'AZ', null, 'primary', 'Arizona 2026 Primary', '2026-07-21', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'AR', null, 'primary', 'Arkansas 2026 Primary', '2026-03-03', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'AR', null, 'primary_runoff', 'Arkansas 2026 Primary Runoff', '2026-03-31', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'CA', null, 'primary', 'California 2026 Primary', '2026-06-02', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'CO', null, 'primary', 'Colorado 2026 Primary', '2026-06-30', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'CT', null, 'primary', 'Connecticut 2026 Primary', '2026-08-11', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'DE', null, 'primary', 'Delaware 2026 Primary', '2026-09-15', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'FL', null, 'primary', 'Florida 2026 Primary', '2026-08-18', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'GA', null, 'primary', 'Georgia 2026 Primary', '2026-05-19', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'GA', null, 'primary_runoff', 'Georgia 2026 Primary Runoff', '2026-06-16', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'HI', null, 'primary', 'Hawaii 2026 Primary', '2026-08-08', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'ID', null, 'primary', 'Idaho 2026 Primary', '2026-05-19', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'IL', null, 'primary', 'Illinois 2026 Primary', '2026-03-17', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'IN', null, 'primary', 'Indiana 2026 Primary', '2026-05-05', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'IA', null, 'primary', 'Iowa 2026 Primary', '2026-06-02', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'KS', null, 'primary', 'Kansas 2026 Primary', '2026-08-04', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'KY', null, 'primary', 'Kentucky 2026 Primary', '2026-05-19', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'LA', null, 'primary', 'Louisiana 2026 Primary — U.S. Senate and local offices', '2026-05-16', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'LA', null, 'primary_runoff', 'Louisiana 2026 Primary Runoff — U.S. Senate and local offices', '2026-06-27', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'LA', null, 'primary', 'Louisiana 2026 Primary — U.S. House', '2026-11-03', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'LA', null, 'primary_runoff', 'Louisiana 2026 Primary Runoff — U.S. House', '2026-12-12', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'ME', null, 'primary', 'Maine 2026 Primary', '2026-06-09', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MD', null, 'primary', 'Maryland 2026 Primary', '2026-06-23', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MA', null, 'primary', 'Massachusetts 2026 Primary', '2026-09-01', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MI', null, 'primary', 'Michigan 2026 Primary', '2026-08-04', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MN', null, 'primary', 'Minnesota 2026 Primary', '2026-08-11', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MS', null, 'primary', 'Mississippi 2026 Primary', '2026-03-10', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MS', null, 'primary_runoff', 'Mississippi 2026 Primary Runoff', '2026-04-07', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MO', null, 'primary', 'Missouri 2026 Primary', '2026-08-04', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'MT', null, 'primary', 'Montana 2026 Primary', '2026-06-02', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NE', null, 'primary', 'Nebraska 2026 Primary', '2026-05-12', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NV', null, 'primary', 'Nevada 2026 Primary', '2026-06-09', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NH', null, 'primary', 'New Hampshire 2026 Primary', '2026-09-08', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NJ', null, 'primary', 'New Jersey 2026 Primary', '2026-06-02', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NM', null, 'primary', 'New Mexico 2026 Primary', '2026-06-02', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NY', null, 'primary', 'New York 2026 Primary', '2026-06-23', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NC', null, 'primary', 'North Carolina 2026 Primary', '2026-03-03', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'NC', null, 'primary_runoff', 'North Carolina 2026 Primary Runoff', '2026-05-12', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'ND', null, 'primary', 'North Dakota 2026 Primary', '2026-06-09', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'OH', null, 'primary', 'Ohio 2026 Primary', '2026-05-05', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'OK', null, 'primary', 'Oklahoma 2026 Primary', '2026-06-16', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'OK', null, 'primary_runoff', 'Oklahoma 2026 Primary Runoff', '2026-08-25', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'OR', null, 'primary', 'Oregon 2026 Primary', '2026-05-19', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'PA', null, 'primary', 'Pennsylvania 2026 Primary', '2026-05-19', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'RI', null, 'primary', 'Rhode Island 2026 Primary', '2026-09-09', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'SC', null, 'primary', 'South Carolina 2026 Primary', '2026-06-09', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'SC', null, 'primary_runoff', 'South Carolina 2026 Primary Runoff', '2026-06-23', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'SD', null, 'primary', 'South Dakota 2026 Primary', '2026-06-02', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'SD', null, 'primary_runoff', 'South Dakota 2026 Primary Runoff', '2026-07-28', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'TN', null, 'primary', 'Tennessee 2026 Primary', '2026-08-06', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'TX', null, 'primary', 'Texas 2026 Primary', '2026-03-03', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'TX', null, 'primary_runoff', 'Texas 2026 Primary Runoff', '2026-05-26', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'UT', null, 'primary', 'Utah 2026 Primary', '2026-06-23', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'VT', null, 'primary', 'Vermont 2026 Primary', '2026-08-11', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'VA', null, 'primary', 'Virginia 2026 Primary', '2026-08-04', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'WA', null, 'primary', 'Washington 2026 Primary', '2026-08-04', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'WV', null, 'primary', 'West Virginia 2026 Primary', '2026-05-12', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'WI', null, 'primary', 'Wisconsin 2026 Primary', '2026-08-11', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates'),
('state', 'WY', null, 'primary', 'Wyoming 2026 Primary', '2026-08-18', 'ncsl', 'https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates')
) AS v(scope, state, locality, election_type, title, election_date, source, source_url)
WHERE NOT EXISTS (SELECT 1 FROM election_dates WHERE source IN ('ncsl', 'federal_seed'));
