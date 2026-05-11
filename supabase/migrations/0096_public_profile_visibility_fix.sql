-- ============================================================
-- 0096_public_profile_visibility_fix
--
-- Privacy bug: get_public_profile / get_public_profiles filter on
-- `profile_visibility <> 'private'`, which accepts BOTH 'public' AND
-- 'recruiters_only'. That means users who pick "recruiters only" —
-- which the onboarding copy promises means "only your leader sees you"
-- — are currently visible to anyone via the RPCs called from /profile,
-- /forum, /messages/new, and the chat lounge.
--
-- Fix: tighten the filter to `profile_visibility = 'public'`. The
-- leader-recruits surface uses its own RLS-protected query against
-- profiles directly (with auth.uid() context), so it's unaffected.
-- ============================================================

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
     and profile_visibility = 'public';
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
     and profile_visibility = 'public';
$$;

grant execute on function public.get_public_profile(uuid) to authenticated, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, anon;
