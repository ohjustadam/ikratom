-- ============================================================
-- 0054_discord_account_link
--
-- "Sign in with Discord" / Discord-account linking on existing iKratom
-- profiles. Adds the Discord identity columns + a unique index so two
-- iKratom accounts can't claim the same Discord user.
--
-- discord_id: Discord's snowflake (string of digits, never numeric in
-- practice — store as text). Stable per user even if username changes.
-- discord_username + avatar_url: cached display info, refreshed on
-- each successful link/sign-in.
-- ============================================================

alter table public.profiles
  add column if not exists discord_id text,
  add column if not exists discord_username text,
  add column if not exists discord_avatar_url text,
  add column if not exists discord_linked_at timestamptz;

-- One Discord account = one iKratom profile. Partial unique index so
-- the rule applies only to rows where discord_id is set (allowing many
-- profiles with NULL discord_id).
create unique index if not exists ux_profiles_discord_id
  on public.profiles (discord_id)
  where discord_id is not null;

-- Update get_public_profile + get_public_profiles to expose discord
-- username (but NOT id — username is the social handle). Drop first
-- because Postgres can't change OUT-parameter return shape via REPLACE.
drop function if exists public.get_public_profile(uuid);
drop function if exists public.get_public_profiles(uuid[]);

create or replace function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  full_name text,
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
  select id, full_name, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at,
         discord_username
    from public.profiles
   where id = p_id;
$$;

create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  full_name text,
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
  select id, full_name, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at,
         discord_username
    from public.profiles
   where id = any(p_ids);
$$;
