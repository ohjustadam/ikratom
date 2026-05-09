-- ============================================================
-- 0075_profile_character_fields
--
-- Round out the user profile with the "character creation" data we
-- ask for during onboarding (per owner's video-game framing). Each
-- field is optional but powers a different downstream feature:
--
--   avatar_url            → topbar pic next to action area
--   kratom_story          → AI tailoring of campaign emails uses this
--                           as the user's "authentic voice" source
--   kratom_years          → narrative weight in legislator letters
--                           ("11-year kratom user from Toledo, OH")
--   advocate_type         → consumer | shop_owner | medical_pro |
--                           family | veteran | researcher | leader |
--                           other — drives default email templates
--                           + community filter
--   lose_if_banned        → one-sentence "what's at stake for you"
--                           — devastatingly effective campaign filler
--   video_url             → optional YouTube / Vimeo / Cloudflare URL
--                           to a personal advocacy clip; surfaced on
--                           public profile
--   video_provider        → 'youtube' | 'vimeo' | 'r2' | 'other'
--                           drives the embed shape
--   referrer_id           → which leader brought this user in.
--                           powers the /leader recruit-count panel
--                           and (later) team hierarchy.
--   tour_seen             → jsonb map of {<surface>: timestamp} so
--                           per-page first-visit tooltips fire once
--                           and stay dismissed
--   onboarded_at          → null until user finishes the wizard;
--                           gates onboarding redirect
--   sms_consent_at        → null = no consent. Future feature; lets
--                           us add a column today so the consent flow
--                           later doesn't need a migration.
--   profile_visibility    → 'public' | 'recruiters_only' | 'private'
--                           shop owners + medical pros often want to
--                           act without their participation showing
--                           up publicly
-- ============================================================

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists kratom_story text,
  add column if not exists kratom_years int,
  add column if not exists advocate_type text,
  add column if not exists lose_if_banned text,
  add column if not exists video_url text,
  add column if not exists video_provider text,
  add column if not exists referrer_id uuid references public.profiles(id) on delete set null,
  add column if not exists tour_seen jsonb not null default '{}'::jsonb,
  add column if not exists onboarded_at timestamptz,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists profile_visibility text not null default 'public';

-- Constraints
alter table public.profiles
  drop constraint if exists profiles_advocate_type_chk;
alter table public.profiles
  add constraint profiles_advocate_type_chk
  check (advocate_type is null or advocate_type in (
    'consumer', 'shop_owner', 'medical_pro', 'family',
    'veteran', 'researcher', 'leader', 'other'
  ));

alter table public.profiles
  drop constraint if exists profiles_video_provider_chk;
alter table public.profiles
  add constraint profiles_video_provider_chk
  check (video_provider is null or video_provider in (
    'youtube', 'vimeo', 'r2', 'other'
  ));

alter table public.profiles
  drop constraint if exists profiles_visibility_chk;
alter table public.profiles
  add constraint profiles_visibility_chk
  check (profile_visibility in ('public', 'recruiters_only', 'private'));

alter table public.profiles
  drop constraint if exists profiles_kratom_years_chk;
alter table public.profiles
  add constraint profiles_kratom_years_chk
  check (kratom_years is null or (kratom_years >= 0 and kratom_years <= 80));

alter table public.profiles
  drop constraint if exists profiles_kratom_story_len;
alter table public.profiles
  add constraint profiles_kratom_story_len
  check (kratom_story is null or char_length(kratom_story) <= 10000);

alter table public.profiles
  drop constraint if exists profiles_lose_if_banned_len;
alter table public.profiles
  add constraint profiles_lose_if_banned_len
  check (lose_if_banned is null or char_length(lose_if_banned) <= 500);

create index if not exists ix_profiles_referrer
  on public.profiles (referrer_id)
  where referrer_id is not null;

create index if not exists ix_profiles_advocate_type
  on public.profiles (advocate_type)
  where advocate_type is not null;

-- Update the public profile RPC to expose username + avatar_url +
-- advocate_type (the things other users can see). DO NOT expose
-- kratom_story / lose_if_banned / referrer / address / etc — those
-- are kept private and only used for AI tailoring + auto-targeting.
drop function if exists public.get_public_profile(uuid);
drop function if exists public.get_public_profiles(uuid[]);

create or replace function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  state text,
  city text,
  county text,
  is_advocate_leader boolean,
  is_admin boolean,
  is_owner boolean,
  advocate_type text,
  intel_tier text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, username, full_name, avatar_url, state, city, county,
         is_advocate_leader, is_admin, is_owner, advocate_type,
         intel_tier, created_at
    from public.profiles
   where id = p_id
     and profile_visibility <> 'private';
$$;

create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  state text,
  city text,
  county text,
  is_advocate_leader boolean,
  is_admin boolean,
  is_owner boolean,
  advocate_type text,
  intel_tier text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, username, full_name, avatar_url, state, city, county,
         is_advocate_leader, is_admin, is_owner, advocate_type,
         intel_tier, created_at
    from public.profiles
   where id = any(p_ids)
     and profile_visibility <> 'private';
$$;

grant execute on function public.get_public_profile(uuid) to authenticated, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, anon;
