-- 0177_notification_timezone.sql
-- Per-user IANA time zone, captured from the browser when a user sets their
-- quiet hours. Quiet hours (0176) are stored as a LOCAL time window
-- (e.g. 22:00 → 07:00); to decide whether "now" falls inside that window the
-- delivery paths need to know the user's zone. Without it we cannot evaluate
-- quiet hours, so the gate only honours dnd_enabled and ignores the window.
--
-- Nullable on purpose: an unset zone means "quiet hours can't be evaluated →
-- deliver" (dnd_enabled still applies). The notification settings form fills
-- this in (Intl.DateTimeFormat().resolvedOptions().timeZone) whenever the user
-- saves, so any user who has set a quiet-hours window also has a zone.
--
-- Rollback:
--   alter table public.notification_preferences drop column if exists timezone;

alter table public.notification_preferences
  add column if not exists timezone text;
