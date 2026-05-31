-- 0166_meeting_auto_approve_policy.sql
--
-- Admin-configurable auto-approval policy for AI-extracted municipal
-- meetings. extract-news-events.mjs and discover-municipal-meetings.mjs
-- seed rows as moderation_status='pending_review'. This policy lets
-- scripts/auto-approve-meetings.mjs promote the high-confidence ones to
-- 'approved' automatically (so they hit /calendar + fire reminders)
-- without a manual admin click — while still gating low-confidence /
-- source-less rows for human review.
--
-- Stored on the site_config singleton (id=true) alongside the other
-- admin-tunable toggles (emergency_mode, read_only_mode). Editable from
-- /admin/meetings without a deploy.
--
-- Defaults: ENABLED, confidence ≥ 0.85, source_url required. Conservative
-- enough to keep hallucinated dates off the public calendar, while still
-- being hands-off for clearly-sourced high-confidence events.
--
-- Rollback: drop the three columns.

ALTER TABLE public.site_config
  ADD COLUMN IF NOT EXISTS meeting_auto_approve_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS meeting_auto_approve_min_confidence numeric NOT NULL DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS meeting_auto_approve_require_source boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.site_config.meeting_auto_approve_enabled IS
  'When true, scripts/auto-approve-meetings.mjs promotes pending_review municipal_meetings that meet the confidence + source criteria to approved automatically.';
COMMENT ON COLUMN public.site_config.meeting_auto_approve_min_confidence IS
  'Minimum ai_confidence (0..1) a pending meeting needs for auto-approval.';
COMMENT ON COLUMN public.site_config.meeting_auto_approve_require_source IS
  'When true, only auto-approve meetings that have a non-null source_url.';
