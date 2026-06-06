-- 0176_push_quiet_hours.sql
-- Per-user quiet hours + Do-Not-Disturb for push delivery.
--
-- Adds three columns to public.notification_preferences:
--   quiet_hours_start (time, nullable) — local-time window start, e.g. 22:00
--   quiet_hours_end   (time, nullable) — local-time window end,   e.g. 07:00
--     (a window that wraps midnight, start > end, is allowed and means
--      "from start tonight through end tomorrow morning")
--   dnd_enabled (boolean, NOT NULL, default false) — hard mute switch
--
-- Every push delivery path MUST consult these before sending: if dnd_enabled
-- is true, or "now" (in the user's local time) falls inside the quiet-hours
-- window, the push is held — it stays in the inbox and rolls into the next
-- allowed delivery, exactly like the throttle from 0175. Quiet hours are
-- nullable so an unset window means "no quiet hours" (deliver any time).
--
-- Delivery paths that must check these columns:
--   src/modules/notifications/push-fanout.ts   (the push-fanout cron)
--   scripts/fire-meeting-reminders.mjs         (direct-send)
--   scripts/broadcast-meeting-cli.mjs          (direct-send)
--   scripts/fire-daily-brief-push.mjs          (direct-send)
-- No application logic is wired up in this migration — schema only.
--
-- Rollback:
--   alter table public.notification_preferences
--     drop column if exists quiet_hours_start,
--     drop column if exists quiet_hours_end,
--     drop column if exists dnd_enabled;

alter table public.notification_preferences
  add column if not exists quiet_hours_start time,
  add column if not exists quiet_hours_end   time,
  add column if not exists dnd_enabled boolean not null default false;
