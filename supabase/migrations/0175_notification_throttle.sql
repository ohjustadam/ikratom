-- 0175_notification_throttle.sql
-- Anti-spam push safeguard: a user must NEVER get a rapid burst of push
-- notifications (e.g. while they're in a meeting), even when many alerts
-- qualify in the same tick or a legitimate dump lands all at once.
--
-- fanoutPushNotifications() now (a) COALESCES all of a user's pending
-- notifications in one run into a SINGLE digest push ("N new updates"), and
-- (b) enforces a minimum spacing between pushes per user via last_push_at +
-- push_min_interval_minutes. Held notifications stay in the inbox and roll
-- into the next allowed digest. digest='off' / in_app=false still suppress.
--
-- Rollback:
--   alter table public.notification_preferences
--     drop column if exists push_min_interval_minutes,
--     drop column if exists last_push_at;

alter table public.notification_preferences
  add column if not exists push_min_interval_minutes int not null default 10,
  add column if not exists last_push_at timestamptz;

alter table public.notification_preferences drop constraint if exists np_push_interval_chk;
alter table public.notification_preferences add constraint np_push_interval_chk
  check (push_min_interval_minutes between 0 and 1440);
