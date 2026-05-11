-- ============================================================
-- 0082_account_locking
--
-- Owner-only temporary account suspension. Sets a flag on profiles
-- that proxy.ts (root middleware) checks before letting any
-- authenticated request through — locked users get bounced to a
-- /locked page explaining why with a contact-support link.
--
-- Use case: a user is abusing the platform but a permanent ban is
-- overkill. Owner locks the account, investigates, unlocks or
-- escalates to ban.
-- ============================================================

alter table public.profiles
  add column if not exists account_locked_at timestamptz,
  add column if not exists account_locked_reason text;

create index if not exists ix_profiles_account_locked
  on public.profiles (id)
  where account_locked_at is not null;

comment on column public.profiles.account_locked_at is
  'Set by owner via /admin/users → Lock account. proxy.ts checks this and bounces locked users to /locked. Null = unlocked.';
