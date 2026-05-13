-- 0117: Track which reminder windows have fired for each meeting.
--
-- A meeting can fire up to three reminder notifications to in-state
-- users — 7 days out, 3 days out, and 1 day out. We need per-meeting
-- per-window dedupe so the daily cron doesn't re-send the same
-- reminder every day.
--
-- Each column stamps the timestamp the reminder went out; NULL means
-- "not sent yet." If a meeting is created <7d out, the 7d reminder
-- never fires; that's fine.

ALTER TABLE municipal_meetings
  ADD COLUMN IF NOT EXISTS reminder_7d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_3d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_1d_sent_at timestamptz;

COMMENT ON COLUMN municipal_meetings.reminder_7d_sent_at IS
  'When the 7-days-out reminder push notification fired (NULL = not yet).';
COMMENT ON COLUMN municipal_meetings.reminder_3d_sent_at IS
  'When the 3-days-out reminder push notification fired (NULL = not yet).';
COMMENT ON COLUMN municipal_meetings.reminder_1d_sent_at IS
  'When the 1-day-out reminder push notification fired (NULL = not yet).';
