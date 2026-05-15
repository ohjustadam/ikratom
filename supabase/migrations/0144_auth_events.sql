-- 0144 — Auth event tracking for self-healing diagnostics.
--
-- Owner directive 2026-05-15: 'we need to create a failsafe, self-healing
-- option if this happens again, if thats possible. same as tracking the
-- user login failure or create an account failure.'
--
-- Single table that records every auth-related attempt with its outcome.
-- Captures:
--   - kind: signup | login | oauth_start | oauth_callback | password_reset
--   - provider: gmail | discord | google_signin | password | magic_link
--   - status: ok | fail
--   - error_code: when fail, the structured reason (e.g. 'redirect_uri_mismatch')
--   - error_message: free-text detail (truncated)
--   - user_id: if known (NULL for pre-auth failures like bad-email signups)
--   - email: best-effort email captured at attempt time
--   - ip + user_agent: for abuse triage; NOT used for auth state
--
-- Read pattern: /admin/oauth-config + /admin/data-quality query for
-- recent failure aggregates to surface "3 redirect_uri_mismatch errors
-- in last 24h" alerts.
--
-- Write pattern: every OAuth start/callback + every signup/login server
-- action calls a small `recordAuthEvent()` helper. Best-effort — never
-- blocks the user flow on log-write failures.
--
-- RLS:
--   - SELECT: admins only (it contains user emails + IPs)
--   - INSERT: authenticated users CAN insert their own events (via the
--     server-side helper which sets actor_id from auth.uid()); admins
--     can insert anyone's via service-role
--   - No UPDATE/DELETE policies — events are immutable
--
-- Rollback:
--   DROP TABLE public.auth_events;

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  -- What kind of event this was
  kind text not null check (kind in (
    'signup', 'login', 'logout',
    'oauth_start', 'oauth_callback',
    'password_reset_request', 'password_reset_complete',
    'mfa_challenge', 'mfa_verify',
    'gmail_connect', 'discord_connect'
  )),
  -- Provider the attempt targeted, if applicable
  provider text check (provider is null or provider in (
    'password', 'magic_link', 'totp',
    'gmail', 'discord', 'google_signin'
  )),
  -- Outcome
  status text not null check (status in ('ok', 'fail', 'cancelled')),
  -- Structured error code on failure (e.g. 'redirect_uri_mismatch',
  -- 'wrong_password', 'token_exchange'). Used for aggregation + auto-suggest.
  error_code text,
  -- Human-readable error detail, capped
  error_message text,
  -- User if known (NULL for pre-auth flows where lookup failed)
  user_id uuid references auth.users(id) on delete set null,
  -- Best-effort email captured from the attempt
  email text,
  -- Triage signals (never used for auth state)
  ip text,
  user_agent text,
  -- Free-form context (e.g. redirect_uri value, OAuth state hash)
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_auth_events_created_at on public.auth_events (created_at desc);
create index if not exists ix_auth_events_kind_status on public.auth_events (kind, status, created_at desc);
create index if not exists ix_auth_events_user on public.auth_events (user_id) where user_id is not null;
create index if not exists ix_auth_events_error on public.auth_events (error_code, created_at desc) where error_code is not null;

alter table public.auth_events enable row level security;

drop policy if exists auth_events_read_admin on public.auth_events;
create policy auth_events_read_admin on public.auth_events
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists auth_events_insert_self on public.auth_events;
create policy auth_events_insert_self on public.auth_events
  for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

comment on table public.auth_events is
  '0144: tracks every auth-related attempt + outcome for self-healing diagnostics. /admin/oauth-config surfaces aggregates so admin can spot patterns (e.g. multiple redirect_uri_mismatch errors → check Google Console).';
