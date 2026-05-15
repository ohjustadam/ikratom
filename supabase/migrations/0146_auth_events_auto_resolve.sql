-- 0146 — Auto-resolution + dev-issue tracking for auth_events.
--
-- Owner directive 2026-05-15: 'can you automate the fix process before it
-- lands in our pending review so it only ends up in pending review if you
-- are unable to fix it for some reason?'
--
-- Two new dimensions on auth_events:
--   1. AUTO-RESOLUTION: every failure event is run through a classifier
--      (src/lib/auth-events-auto-fix.ts). Known user-side errors
--      (wrong_password, access_denied) self-resolve and never escalate.
--      Transient errors (token_exchange) are marked retry-suggested.
--      Only true config drift (redirect_uri_mismatch, invalid_client,
--      db_signup) escalates to the admin surface.
--
--   2. DEV ESCALATION: admin can click "Send to devs" on any unresolved
--      cluster to file a GitHub issue. dev_issue_url + dev_issue_filed_at
--      track the resulting URL so the same cluster isn't re-filed.
--
-- Read pattern: recentAuthFailureSummary() now filters to events where
-- escalated_to_admin=true (or auto_fix_attempted IS NULL for backward
-- compat with rows written before this migration).
--
-- Write pattern: recordAuthEvent() inserts then calls attemptAutoFix()
-- and updates the row with the classifier's verdict.
--
-- Rollback:
--   ALTER TABLE auth_events DROP COLUMN auto_fix_attempted,
--                           DROP COLUMN auto_fix_outcome,
--                           DROP COLUMN auto_fix_notes,
--                           DROP COLUMN escalated_to_admin,
--                           DROP COLUMN dev_issue_url,
--                           DROP COLUMN dev_issue_filed_at;

alter table public.auth_events
  add column if not exists auto_fix_attempted boolean not null default false,
  add column if not exists auto_fix_outcome text check (auto_fix_outcome is null or auto_fix_outcome in (
    'resolved_user_side',     -- wrong_password / access_denied / etc — no admin action
    'resolved_transient',     -- token_exchange / network — likely self-resolves
    'resolved_dismissed',     -- bad_state / cookie issue — user retry usually fixes
    'escalated_config',       -- redirect_uri_mismatch / invalid_client — admin must act
    'escalated_unknown'       -- error_code we don't recognize — admin should triage
  )),
  add column if not exists auto_fix_notes text,
  add column if not exists escalated_to_admin boolean not null default false,
  add column if not exists dev_issue_url text,
  add column if not exists dev_issue_filed_at timestamptz;

-- Index for the "only show escalated failures" admin query path.
create index if not exists ix_auth_events_escalated on public.auth_events
  (escalated_to_admin, created_at desc) where escalated_to_admin = true;

comment on column public.auth_events.auto_fix_attempted is
  '0146: true once the classifier has run on this row. NULL legacy rows are treated as if escalated for the read query.';
comment on column public.auth_events.auto_fix_outcome is
  '0146: classifier verdict. resolved_* never reaches admin surface; escalated_* does.';
comment on column public.auth_events.escalated_to_admin is
  '0146: convenience flag. True when auto_fix_outcome starts with escalated_, or when the classifier failed.';
comment on column public.auth_events.dev_issue_url is
  '0146: GitHub issue URL if admin clicked "Send to devs" for this failure cluster.';
