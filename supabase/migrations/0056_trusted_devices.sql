-- ============================================================
-- 0056_trusted_devices
--
-- "Remember this device" — opt-in trust for the browser/device after a
-- successful MFA verification, so the user doesn't have to enter their
-- TOTP code on every routine sign-in.
--
-- Security model:
--   - device_id: random 64-char string, generated server-side, stored
--     in a SIGNED HttpOnly cookie. The cookie's HMAC uses CRON_SECRET
--     so we don't need a new env secret.
--   - On signIn: we check the cookie's HMAC, then look up the matching
--     row in this table (user_id + device_id + expires_at > now). If
--     valid, we skip the /login/mfa redirect and let the user proceed
--     at aal1. SENSITIVE actions (admin mutations, password change,
--     MFA management) still re-prompt for aal2 — trusted-device only
--     skips the routine challenge.
--   - Default expiry: 30 days. User can revoke individual devices on
--     /account/security.
--   - last_used_at refreshes on each successful trusted sign-in, so
--     the list shows real recency.
-- ============================================================

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The device id matches the value in the user's signed cookie. Random
  -- per-device, never reused.
  device_id text not null check (length(device_id) between 32 and 80),
  -- Display only — UAs change, we don't match against this. Used in the
  -- /account/security list so the user can recognize "Chrome on Windows
  -- from <last IP>".
  ua_summary text,
  ip_seen text,
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists idx_trusted_devices_user
  on public.trusted_devices (user_id, expires_at desc);

alter table public.trusted_devices enable row level security;

drop policy if exists "trusted_devices_self" on public.trusted_devices;
create policy "trusted_devices_self"
  on public.trusted_devices for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Optional cleanup: drop expired rows. Called from the daily-sync cron.
create or replace function public.prune_trusted_devices()
returns int
language sql
security definer
as $$
  with del as (
    delete from public.trusted_devices
     where expires_at < now()
    returning 1
  )
  select count(*)::int from del;
$$;

revoke all on function public.prune_trusted_devices() from public;
grant execute on function public.prune_trusted_devices() to authenticated;
