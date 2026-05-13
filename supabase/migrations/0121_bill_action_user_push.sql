-- 0121: Dedupe table for per-user bill-action push notifications.
--
-- When a bill changes status (e.g. introduced → committee → enacted)
-- a new bill_actions row lands. Users who personally took action on
-- that bill via /campaigns flow (campaign_actions) should get a push
-- alerting them to the change — they invested 2 minutes emailing
-- their rep and deserve to know whether the bill moved.
--
-- This table prevents re-pushing the same (user, bill_action) pair
-- if the cron runs multiple times in the same hour.
--
-- Rollback:
--   DROP TABLE IF EXISTS bill_action_user_pushes;

CREATE TABLE IF NOT EXISTS bill_action_user_pushes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bill_action_id uuid NOT NULL REFERENCES bill_actions(id) ON DELETE CASCADE,
  pushed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bill_action_id)
);

CREATE INDEX IF NOT EXISTS ix_bill_action_user_pushes_user
  ON bill_action_user_pushes(user_id, pushed_at DESC);

ALTER TABLE bill_action_user_pushes ENABLE ROW LEVEL SECURITY;

-- Users can read their own to see when they were notified.
DROP POLICY IF EXISTS "bill_action_user_pushes_self_read" ON bill_action_user_pushes;
CREATE POLICY "bill_action_user_pushes_self_read"
  ON bill_action_user_pushes FOR SELECT
  USING (auth.uid() = user_id);

-- Only service-role writes (cron).
DROP POLICY IF EXISTS "bill_action_user_pushes_admin_all" ON bill_action_user_pushes;
CREATE POLICY "bill_action_user_pushes_admin_all"
  ON bill_action_user_pushes FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE bill_action_user_pushes IS
  'Per-user-per-bill-action push dedupe. Cron inserts after sending; same row blocks re-push.';
