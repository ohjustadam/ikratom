-- ============================================================
-- 0015 — Onboarding completion tracking
-- ============================================================

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- Backfill existing accounts so we don't push them through onboarding.
-- They're already using the platform — assume done.
update public.profiles
set onboarded_at = now()
where onboarded_at is null;
