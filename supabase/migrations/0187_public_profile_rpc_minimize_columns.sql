-- 0187: Restrict get_public_profile(s) to PUBLIC-SAFE columns only.
--
-- Problem (anonymity / PII on the wire): the public-profile RPCs are
-- SECURITY DEFINER + granted to anon, and returned full_name, city, county,
-- is_owner, advocate_type, intel_tier, and created_at. Callers render only
-- publicHandle (@username) + avatars + admin/leader badges, BUT every one of
-- those sensitive fields traveled to the browser anyway — a soft anonymity
-- leak: anyone could call the RPC (or read the network tab) and harvest other
-- users' real names, city-level location, account age (doxing vector), and
-- privilege level. Standing rule #1: public surfaces expose @username only.
--
-- Fix: the RPCs now return ONLY the columns the public UI legitimately uses:
--   id, username, state, avatar_url, is_admin, is_advocate_leader.
-- Dropped: full_name, city, county, is_owner, advocate_type, intel_tier,
-- created_at. (avatar_url + the two role flags are intentional public signals:
-- avatars, an "admin"/"leader" badge. The only caller that read full_name —
-- the /calls leaderboard — is updated in the same PR to render @username.)
--
-- The `profile_visibility = 'public'` row filter (migration 0096) is preserved.
-- DROP + CREATE (not CREATE OR REPLACE) because the OUT-column set changes.
--
-- Rollback: re-apply the migration 0096 bodies (the wider column list).

drop function if exists public.get_public_profile(uuid);
drop function if exists public.get_public_profiles(uuid[]);

create function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  username text,
  state text,
  avatar_url text,
  is_admin boolean,
  is_advocate_leader boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select id, username, state, avatar_url, is_admin, is_advocate_leader
    from public.profiles
   where id = p_id
     and profile_visibility = 'public';
$$;

create function public.get_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  username text,
  state text,
  avatar_url text,
  is_admin boolean,
  is_advocate_leader boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select id, username, state, avatar_url, is_admin, is_advocate_leader
    from public.profiles
   where id = any(p_ids)
     and profile_visibility = 'public';
$$;

grant execute on function public.get_public_profile(uuid) to authenticated, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, anon;

comment on function public.get_public_profiles is
  'Public-safe profile lookup (SECURITY DEFINER, profile_visibility=public only). Returns ONLY id/username/state/avatar_url/is_admin/is_advocate_leader — never full_name/email/city/created_at/privilege. Render identity via publicHandle().';
