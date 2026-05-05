-- ============================================================
-- 0023 — Login device tracking + new-device alerts
-- ============================================================
-- Tracks unique (user, device-fingerprint) pairs so we can detect
-- sign-ins from devices we haven't seen before. On new-device sign-in
-- the auth flow inserts a 'new_device' notification (in-app); email
-- alert will follow once we wire a transactional email provider.
--
-- Fingerprint = sha256(lowercase(user_agent_first_120_chars) || '|' || ip).
-- Not perfectly stable (UA strings shift, IPs rotate on mobile) but good
-- enough to flag the obvious "different person, different country" case.
-- ============================================================

create table if not exists public.login_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint_hash text not null,
  ip text,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sign_in_count integer not null default 1,
  unique (user_id, fingerprint_hash)
);

create index if not exists login_devices_user_idx
  on public.login_devices (user_id, last_seen_at desc);

-- RLS: users read their own devices; writes are service-role only
-- (the recordSignIn action uses service role since the user's session
-- isn't yet established at the moment we record).
alter table public.login_devices enable row level security;

drop policy if exists "login_devices_self_read" on public.login_devices;
create policy "login_devices_self_read" on public.login_devices
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies — locked to service role.
