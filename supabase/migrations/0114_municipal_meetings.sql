-- 0114: Municipal meetings discovery.
--
-- Owner directive: detect city/county council meetings (and any
-- public hearing) where kratom is on the agenda. Drive same-day or
-- next-day Zoom participation from our user base, before users have
-- to file an intel tip.
--
-- ~95% of US municipalities use one of four agenda-management
-- platforms (Granicus, BoardDocs, CivicClerk, Legistar) — all with
-- predictable URL patterns. We'll onboard them platform-by-platform.
-- For the long tail, Gemini-grounded search runs daily looking for
-- kratom-related local meetings.
--
-- Rollback:
--   DROP TABLE IF EXISTS municipal_meetings;

CREATE TABLE IF NOT EXISTS municipal_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Location
  state text NOT NULL,
  locality text,                              -- "Sarasota, FL" / "Cook County, IL"
  body_name text,                             -- "City Council" / "Board of Supervisors" / "Zoning Board"
  -- Meeting timing
  meeting_at timestamptz NOT NULL,            -- when the meeting starts
  meeting_end_at timestamptz,
  is_recurring boolean DEFAULT false,         -- weekly council = recurring
  -- Where
  format text NOT NULL DEFAULT 'hybrid'
    CHECK (format IN ('in_person', 'virtual', 'hybrid', 'unknown')),
  zoom_url text,                              -- live link if known
  zoom_webinar_id text,
  zoom_passcode text,
  in_person_address text,
  livestream_url text,                        -- YouTube / city stream if separate from Zoom
  agenda_url text,                            -- official agenda link
  agenda_text text,                           -- extracted text where kratom appeared
  -- Discovery + classification
  discovered_via text NOT NULL,               -- 'gemini_grounded' / 'granicus_scrape' / 'boarddocs_scrape' / 'user_tip' / 'manual'
  discovered_at timestamptz NOT NULL DEFAULT now(),
  source_url text,                            -- where we found the agenda mention
  kratom_relevance text NOT NULL DEFAULT 'pending'
    CHECK (kratom_relevance IN ('pending', 'confirmed', 'unrelated', 'false_positive')),
  ai_confidence numeric,                      -- 0..1 from the discoverer
  ai_notes text,
  -- Public-comment access
  public_comment_signup_url text,             -- if a separate signup is required
  public_comment_deadline timestamptz,
  written_testimony_url text,
  -- Moderation
  moderation_status text NOT NULL DEFAULT 'pending_review'
    CHECK (moderation_status IN ('pending_review', 'approved', 'rejected', 'archived')),
  moderation_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moderation_reviewed_at timestamptz,
  -- Activity
  notification_sent_at timestamptz,
  user_attended_count int NOT NULL DEFAULT 0,  -- bumped by user self-report
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Note: postgres rejects now() in index predicates because it's not
-- IMMUTABLE. We index by state + meeting_at filtered to approved-only;
-- date filtering happens query-side. Still fast enough.
CREATE INDEX IF NOT EXISTS ix_municipal_meetings_upcoming
  ON municipal_meetings(state, meeting_at)
  WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS ix_municipal_meetings_pending
  ON municipal_meetings(discovered_at DESC)
  WHERE moderation_status = 'pending_review';

-- Dedupe key — same locality + same meeting datetime = same meeting
CREATE UNIQUE INDEX IF NOT EXISTS ux_municipal_meetings_dedupe
  ON municipal_meetings(state, COALESCE(locality, ''), meeting_at);

ALTER TABLE municipal_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read approved meetings" ON municipal_meetings;
CREATE POLICY "Public read approved meetings"
  ON municipal_meetings FOR SELECT
  USING (moderation_status = 'approved');

DROP POLICY IF EXISTS "Admin all meetings" ON municipal_meetings;
CREATE POLICY "Admin all meetings"
  ON municipal_meetings FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE municipal_meetings IS
  'City/county council + board public meetings where kratom is on the agenda. Discovered via AI-grounded search or platform scrapers, admin-moderated before going public.';
