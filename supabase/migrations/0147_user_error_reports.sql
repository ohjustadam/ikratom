-- 0147 — User-reported errors with same self-healing pattern as auth_events.
--
-- Owner directive 2026-05-16: "we need the same self healing capabilities
-- for the user log in as well. the report error button to admin should
-- appear anytime a user gets an error."
--
-- Scope: any user-facing error anywhere on the site (login, signup,
-- submission failures, research-paper fetch failures, etc.) can be
-- reported by the user via a "Report to admin" button. Reports flow
-- through the same auto-fix classifier that auth_events uses (migration
-- 0146) — known user-side errors silently resolved, only escalated
-- issues bubble to admin.
--
-- Schema mirrors auth_events for consistency:
--   - kind: where the error happened ('login' | 'signup' | 'submission' |
--     'navigation' | 'other'). Free-text within the check list so we
--     can extend without migrations.
--   - error_code: structured slug if available (matches auth_events
--     conventions: 'invalid_credentials', 'redirect_uri_mismatch', etc.)
--   - error_message: user-facing copy that was shown
--   - context: jsonb { page_url, user_action, browser, etc }
--   - auto_fix_*, escalated_to_admin, dev_issue_url: classifier output
--     (same shape as auth_events)
--
-- RLS:
--   - INSERT: any authenticated user can report own; anon also allowed
--     since we want signed-out users hitting a login bug to be able to
--     flag it (we capture IP for abuse triage)
--   - SELECT: admins only (contains IPs, user_ids, sometimes emails)
--   - No UPDATE/DELETE policies — events immutable
--
-- Rollback:
--   DROP TABLE public.user_error_reports;

create table if not exists public.user_error_reports (
  id uuid primary key default gen_random_uuid(),
  -- Where the error happened
  kind text not null check (kind in (
    'login', 'signup', 'submission', 'navigation',
    'research_submit', 'forum_post', 'campaign_send',
    'story_submit', 'intel_tip_submit',
    'other'
  )),
  -- Structured slug if the surface tagged it; free-form otherwise
  error_code text,
  -- The actual user-facing message that was displayed
  error_message text,
  -- User context (page, what they were doing). Capped at ~4KB jsonb
  context jsonb,
  -- User identity. NULL for pre-auth flows (signup failure, login
  -- failure with no account)
  user_id uuid references auth.users(id) on delete set null,
  -- Best-effort email captured when known
  email text,
  -- Triage signals
  ip text,
  user_agent text,
  -- The user's own description of what they were trying to do (when
  -- they typed it into the "What were you trying to do?" textarea
  -- on the report modal). Optional.
  user_description text,
  -- Classifier verdict — same shape as auth_events (migration 0146)
  auto_fix_attempted boolean not null default false,
  auto_fix_outcome text check (auto_fix_outcome is null or auto_fix_outcome in (
    'resolved_user_side',
    'resolved_transient',
    'resolved_dismissed',
    'escalated_config',
    'escalated_unknown'
  )),
  auto_fix_notes text,
  escalated_to_admin boolean not null default false,
  -- GitHub issue tracking — stamp the URL when admin clicks "Send to devs"
  dev_issue_url text,
  dev_issue_filed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ix_user_error_reports_created on public.user_error_reports (created_at desc);
create index if not exists ix_user_error_reports_kind on public.user_error_reports (kind, escalated_to_admin, created_at desc);
create index if not exists ix_user_error_reports_user on public.user_error_reports (user_id) where user_id is not null;
create index if not exists ix_user_error_reports_escalated on public.user_error_reports
  (escalated_to_admin, created_at desc) where escalated_to_admin = true;

alter table public.user_error_reports enable row level security;

drop policy if exists user_error_reports_read_admin on public.user_error_reports;
create policy user_error_reports_read_admin on public.user_error_reports
  for select to authenticated using (public.is_admin(auth.uid()));

-- INSERT: authenticated users can insert their own (or no user_id for
-- pre-auth errors). Anon also allowed via the server action which
-- uses the service-role client.
drop policy if exists user_error_reports_insert on public.user_error_reports;
create policy user_error_reports_insert on public.user_error_reports
  for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

comment on table public.user_error_reports is
  '0147: user-reported errors with auto-fix classifier (same flow as auth_events). "Report to admin" buttons across the site write here. Only escalated entries reach admin triage surface; user-side errors silently resolved.';
