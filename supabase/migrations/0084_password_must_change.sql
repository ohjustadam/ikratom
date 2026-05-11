-- ============================================================
-- 0084_password_must_change
--
-- Admin-issued temporary password flow. When an owner/admin
-- generates a temp password for a user (account-recovery support),
-- profiles.password_must_change_at is stamped with now(). The
-- proxy bounces that user to /account/security/force-change on
-- every authenticated request until they set a real password.
--
-- Cleared on successful password change via the existing change-
-- password flow OR the dedicated force-change action.
-- ============================================================

alter table public.profiles
  add column if not exists password_must_change_at timestamptz;

create index if not exists ix_profiles_password_must_change
  on public.profiles (password_must_change_at)
  where password_must_change_at is not null;

comment on column public.profiles.password_must_change_at is
  'Set when an admin issues a temp password. While non-null, the proxy forces the user through the change-password page before any other route. Cleared on successful password change.';
