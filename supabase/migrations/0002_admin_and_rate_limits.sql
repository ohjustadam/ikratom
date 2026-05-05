-- ============================================================
-- 0002 — Admin/Owner roles + Rate limiting
-- ============================================================

-- 1. Add admin/owner flags to profiles
alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_owner boolean not null default false;

-- ============================================================
-- 2. Helper: is_admin(uid) — used by RLS to avoid recursion
--    SECURITY DEFINER so it can read profiles even when called by RLS
-- ============================================================
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or is_owner from public.profiles where id = uid),
    false
  );
$$;

grant execute on function public.is_admin(uuid) to anon, authenticated;

-- ============================================================
-- 3. Admin RLS policies
-- ============================================================
-- Profiles: admins can read + update any profile (for moderation)
drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all" on public.profiles
  for select using (public.is_admin(auth.uid()));

drop policy if exists "profiles_admin_update_all" on public.profiles;
create policy "profiles_admin_update_all" on public.profiles
  for update using (public.is_admin(auth.uid()));

-- Campaigns: admins can do everything
drop policy if exists "campaigns_admin_all" on public.campaigns;
create policy "campaigns_admin_all" on public.campaigns
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Legislators: admins can do everything (sync scripts will use service role)
drop policy if exists "legislators_admin_all" on public.legislators;
create policy "legislators_admin_all" on public.legislators
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Bills: admins can do everything
drop policy if exists "bills_admin_all" on public.bills;
create policy "bills_admin_all" on public.bills
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- States: admins can update kratom_status etc.
drop policy if exists "states_admin_all" on public.states;
create policy "states_admin_all" on public.states
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================
-- 4. Rate limiting table
-- ============================================================
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- Lock down — only callable via the SECURITY DEFINER function below
alter table public.rate_limits enable row level security;
-- (no policies = no direct access via PostgREST)

-- ============================================================
-- 5. check_rate_limit(key, max, window_seconds)
--    Returns true if allowed, false if over limit.
--    Atomic via row lock.
-- ============================================================
create or replace function public.check_rate_limit(
  p_key text,
  p_max int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_record public.rate_limits%rowtype;
begin
  -- Hard cap on inputs to prevent abuse
  if p_max < 1 or p_max > 10000 then return false; end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then return false; end if;
  if length(p_key) > 256 then return false; end if;

  select * into v_record from public.rate_limits where key = p_key for update;

  if not found then
    insert into public.rate_limits (key, window_start, count)
      values (p_key, v_now, 1)
      on conflict (key) do nothing;
    return true;
  end if;

  -- Window expired — reset
  if v_now - v_record.window_start > make_interval(secs => p_window_seconds) then
    update public.rate_limits
      set window_start = v_now, count = 1
      where key = p_key;
    return true;
  end if;

  -- Over limit
  if v_record.count >= p_max then
    return false;
  end if;

  update public.rate_limits set count = count + 1 where key = p_key;
  return true;
end;
$$;

grant execute on function public.check_rate_limit(text, int, int) to anon, authenticated;

-- ============================================================
-- 6. Bootstrap: make ohjustadam@proton.me the owner + admin
--    Safe to re-run; only sets if matching row exists.
-- ============================================================
update public.profiles
set is_owner = true, is_admin = true
where id = (
  select id from auth.users
  where lower(email) = 'ohjustadam@proton.me'
  limit 1
);
