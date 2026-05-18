-- ============================================================
-- 0158_daily_brief_push_opt_in
--
-- Adds an opt-in flag for the Daily Advocate Brief push delivery.
-- Distinct from the existing campaign digest preferences (those
-- govern campaign-related notifications). This flag controls
-- whether the user receives a once-daily web-push containing the
-- AI-summarized brief (the same one at /brief) as a deep-link.
--
-- Default: false. Push delivery is opt-in only — never spam.
-- User can enable in their notification preferences UI.
--
-- Rollback:
--   ALTER TABLE notification_preferences DROP COLUMN daily_brief_push;

alter table public.notification_preferences
  add column if not exists daily_brief_push boolean not null default false;

comment on column public.notification_preferences.daily_brief_push is
  'Opt-in flag for the once-daily Daily Advocate Brief web-push. Default OFF — never enabled without explicit user consent. Fan-out happens via scripts/fire-daily-brief-push.mjs on cron-daily.';
