-- 0115: Track when a meeting was broadcast to users.
-- Used to (a) prevent duplicate broadcasts, (b) show "broadcast at X · N users"
-- on the admin meetings page after the fact.

ALTER TABLE municipal_meetings
  ADD COLUMN IF NOT EXISTS broadcast_at timestamptz,
  ADD COLUMN IF NOT EXISTS broadcast_recipient_count int,
  ADD COLUMN IF NOT EXISTS broadcast_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN municipal_meetings.broadcast_at IS
  'When an admin clicked the "broadcast NOW" button — fans out push notifications + creates a critical policy_alert.';
