-- 0113: Phone-call tracking, transcripts, goals, achievements.
--
-- Owner directive: shift focus toward in-app phone calls to decision-
-- makers. Track each call, optionally transcribe via the browser's
-- Web Speech API (free), aggregate transcripts into open intel about
-- "what is government actually saying" about kratom.
--
-- Recording legality: NY is a two-party-consent state for recording.
-- Transcripts via Web Speech API are technically "device-side speech
-- recognition" of audio the user can already hear — but to be safe,
-- the UI requires the user to confirm consent + (for two-party states)
-- recite a disclosure line before transcript capture starts.
--
-- Workflow:
--   1. User opens a campaign action or a legislator profile.
--   2. Taps "Call now" → tel: link fires the device dialer.
--   3. Optionally taps "Track this call" → app starts a call_session
--      row with consent timestamp.
--   4. If user opts in to transcription: phone on speaker, Web Speech
--      API streams transcript. User can edit before submit.
--   5. User taps "End call" → session is finalized + AI summary
--      generated.
--   6. Transcripts are USER-PRIVATE until reviewed by admin (mirror of
--      kratom_stories flow). Approved ones feed the aggregate intel.
--
-- Goals + achievements are simple counters (calls made, legislators
-- contacted, hours of tracked airtime).
--
-- Rollback:
--   DROP TABLE IF EXISTS call_achievements;
--   DROP TABLE IF EXISTS call_goals;
--   DROP TABLE IF EXISTS call_sessions;

CREATE TABLE IF NOT EXISTS call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who we called (may be legislator OR campaign target OR custom)
  legislator_id uuid REFERENCES legislators(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  bill_id uuid REFERENCES bills(id) ON DELETE SET NULL,
  recipient_name text,                       -- denormalized for ledger ("Sen. James Skoufis")
  recipient_phone text,                      -- E.164 ideally; what the tel: link used
  recipient_role text,                       -- 'state_senate' / 'us_house' / 'staffer' / etc.
  recipient_office text,                     -- 'Albany capitol office' / 'district office' / etc.
  -- Session lifecycle
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds int,
  outcome text,                              -- 'reached' / 'voicemail' / 'busy' / 'declined' / 'no_answer'
  -- Consent + transcription
  recording_consent_given boolean NOT NULL DEFAULT false,
  recording_consent_at timestamptz,
  two_party_disclosure_recited boolean,      -- user confirmed they read the disclosure
  transcript_md text,                        -- live-captured via Web Speech API
  transcript_lang text DEFAULT 'en-US',
  ai_summary_md text,                        -- generated post-call from transcript
  ai_summary_provider text,                  -- which AI provider summarized
  -- Notes the user wrote, beyond the transcript
  user_notes_md text,
  -- Moderation for the public/aggregate intel pool
  moderation_status text NOT NULL DEFAULT 'private'
    CHECK (moderation_status IN ('private', 'pending_review', 'approved', 'rejected')),
  moderation_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moderation_reviewed_at timestamptz,
  moderation_note text,
  -- Auto-fields
  state text,                                -- denorm for fast per-state stats
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_call_sessions_user ON call_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_call_sessions_legislator ON call_sessions(legislator_id)
  WHERE legislator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_call_sessions_state_approved
  ON call_sessions(state, started_at DESC)
  WHERE moderation_status = 'approved';
CREATE INDEX IF NOT EXISTS ix_call_sessions_pending
  ON call_sessions(moderation_status, created_at DESC)
  WHERE moderation_status = 'pending_review';

ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

-- Users see + edit their own sessions
DROP POLICY IF EXISTS "call_sessions_self_read" ON call_sessions;
CREATE POLICY "call_sessions_self_read"
  ON call_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "call_sessions_self_write" ON call_sessions;
CREATE POLICY "call_sessions_self_write"
  ON call_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "call_sessions_self_update" ON call_sessions;
CREATE POLICY "call_sessions_self_update"
  ON call_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins see all
DROP POLICY IF EXISTS "call_sessions_admin_all" ON call_sessions;
CREATE POLICY "call_sessions_admin_all"
  ON call_sessions FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Approved transcripts are world-readable for the aggregate intel surface
DROP POLICY IF EXISTS "call_sessions_approved_public_read" ON call_sessions;
CREATE POLICY "call_sessions_approved_public_read"
  ON call_sessions FOR SELECT
  USING (moderation_status = 'approved');

-- ============================================================
-- 2. call_goals — per-user targets ("call 5 legislators this week")
-- ============================================================
CREATE TABLE IF NOT EXISTS call_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,                        -- 'count' / 'streak' / 'state_coverage' / 'committee_chairs'
  target int NOT NULL,                       -- e.g. 5 calls
  period text NOT NULL,                      -- 'week' / 'month' / 'all_time' / 'campaign'
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  achieved_at timestamptz,
  achieved_count int DEFAULT 0,              -- updated by trigger
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_call_goals_user_active
  ON call_goals(user_id) WHERE achieved_at IS NULL;

ALTER TABLE call_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "call_goals_self" ON call_goals;
CREATE POLICY "call_goals_self"
  ON call_goals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "call_goals_admin" ON call_goals;
CREATE POLICY "call_goals_admin"
  ON call_goals FOR SELECT
  USING (public.is_admin(auth.uid()));

-- ============================================================
-- 3. call_achievements — badges users unlock by call activity
-- ============================================================
CREATE TABLE IF NOT EXISTS call_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_code text NOT NULL,                  -- 'first_call' / 'capital_seven' / 'committee_storm' / etc.
  earned_at timestamptz NOT NULL DEFAULT now(),
  details jsonb,                             -- count, state, legislator_id, etc.
  UNIQUE(user_id, badge_code)
);

CREATE INDEX IF NOT EXISTS ix_call_achievements_user
  ON call_achievements(user_id, earned_at DESC);

ALTER TABLE call_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "call_achievements_self_read" ON call_achievements;
CREATE POLICY "call_achievements_self_read"
  ON call_achievements FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "call_achievements_admin_all" ON call_achievements;
CREATE POLICY "call_achievements_admin_all"
  ON call_achievements FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Public read for community board ("top callers this week")
DROP POLICY IF EXISTS "call_achievements_public_read" ON call_achievements;
CREATE POLICY "call_achievements_public_read"
  ON call_achievements FOR SELECT
  USING (true);

-- ============================================================
-- 4. Trigger: auto-award achievements when a session ends
-- ============================================================
CREATE OR REPLACE FUNCTION public.award_call_achievements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_calls int;
  v_distinct_legislators int;
  v_distinct_states int;
BEGIN
  -- Only fire when a call is finalized (ended_at transitions to non-null)
  IF new.ended_at IS NULL OR (old.ended_at IS NOT NULL) THEN
    RETURN new;
  END IF;

  -- First call
  SELECT count(*) INTO v_total_calls
    FROM call_sessions
    WHERE user_id = new.user_id AND ended_at IS NOT NULL;
  IF v_total_calls = 1 THEN
    INSERT INTO call_achievements (user_id, badge_code, details)
    VALUES (new.user_id, 'first_call', jsonb_build_object('on', new.started_at))
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;

  -- Capital Seven: reached 7 distinct legislators
  SELECT count(DISTINCT legislator_id) INTO v_distinct_legislators
    FROM call_sessions
    WHERE user_id = new.user_id AND ended_at IS NOT NULL AND legislator_id IS NOT NULL;
  IF v_distinct_legislators >= 7 THEN
    INSERT INTO call_achievements (user_id, badge_code, details)
    VALUES (new.user_id, 'capital_seven', jsonb_build_object('legislator_count', v_distinct_legislators))
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;

  -- Coast to coast: calls in ≥5 distinct states
  SELECT count(DISTINCT state) INTO v_distinct_states
    FROM call_sessions
    WHERE user_id = new.user_id AND ended_at IS NOT NULL AND state IS NOT NULL;
  IF v_distinct_states >= 5 THEN
    INSERT INTO call_achievements (user_id, badge_code, details)
    VALUES (new.user_id, 'coast_to_coast', jsonb_build_object('state_count', v_distinct_states))
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;

  -- Century club: 100 total calls
  IF v_total_calls >= 100 THEN
    INSERT INTO call_achievements (user_id, badge_code, details)
    VALUES (new.user_id, 'century_club', jsonb_build_object('total_calls', v_total_calls))
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;

  -- Update active goal progress
  UPDATE call_goals
    SET achieved_count = (
      SELECT count(*) FROM call_sessions
      WHERE user_id = new.user_id
        AND ended_at IS NOT NULL
        AND (call_goals.starts_at IS NULL OR started_at >= call_goals.starts_at)
        AND (call_goals.ends_at IS NULL OR started_at <= call_goals.ends_at)
    )
    WHERE user_id = new.user_id AND achieved_at IS NULL;

  -- Auto-complete goals that hit target
  UPDATE call_goals
    SET achieved_at = now()
    WHERE user_id = new.user_id
      AND achieved_at IS NULL
      AND achieved_count >= target;

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'award_call_achievements failed: %', sqlerrm;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_call_achievements ON call_sessions;
CREATE TRIGGER trg_award_call_achievements
  AFTER UPDATE OF ended_at
  ON call_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.award_call_achievements();

COMMENT ON TABLE call_sessions IS
  'Per-user phone calls to decision-makers. Recorded via tel: launcher + browser Web Speech API. User-private until admin moderation approves for public intel aggregation. See /calls + /admin/calls.';
