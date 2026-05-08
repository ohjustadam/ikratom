-- ============================================================
-- 0057_username_and_leader_tour
--
-- Two onboarding pieces in one migration:
--
-- A) profiles.username — required for new signups, optional for existing
--    rows so we don't break anyone. Lowercase letters, digits, and
--    underscore only, 3-30 chars. Unique per platform.
--
--    Server-side signup action validates presence; the schema only
--    enforces format + uniqueness so existing users without a username
--    can lazily backfill on next profile save.
--
-- B) profiles.leader_tour_pending — true after admin grants
--    is_advocate_leader = true; the dashboard reads this and fires the
--    leader walkthrough tour, then sets it back to false. One-shot.
-- ============================================================

alter table public.profiles
  add column if not exists username text,
  add column if not exists leader_tour_pending boolean not null default false;

-- Format constraint: lowercase a-z, digits, underscore. 3-30 chars.
-- Stored as-typed (we lowercase on the server before insert/update).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_username_format_chk'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format_chk
      check (username is null or username ~ '^[a-z0-9_]{3,30}$');
  end if;
end$$;

-- Unique partial index — only enforces on rows where username is set.
create unique index if not exists ux_profiles_username
  on public.profiles (username)
  where username is not null;

-- Expose username via the public profile RPCs so other users can see it
-- (it's the public handle on chat, forum, etc.). Drop + recreate because
-- Postgres can't change OUT-parameter return shape via REPLACE.
drop function if exists public.get_public_profile(uuid);
drop function if exists public.get_public_profiles(uuid[]);

create or replace function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  full_name text,
  username text,
  state text,
  city text,
  is_owner boolean,
  is_admin boolean,
  is_advocate_leader boolean,
  is_shop_owner boolean,
  shop_name text,
  is_medical_professional boolean,
  public_key text,
  created_at timestamptz,
  discord_username text
)
language sql
security definer
stable
set search_path = public
as $$
  select id, full_name, username, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at,
         discord_username
    from public.profiles
   where id = p_id;
$$;

create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  full_name text,
  username text,
  state text,
  city text,
  is_owner boolean,
  is_admin boolean,
  is_advocate_leader boolean,
  is_shop_owner boolean,
  shop_name text,
  is_medical_professional boolean,
  public_key text,
  created_at timestamptz,
  discord_username text
)
language sql
security definer
stable
set search_path = public
as $$
  select id, full_name, username, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at,
         discord_username
    from public.profiles
   where id = any(p_ids);
$$;
