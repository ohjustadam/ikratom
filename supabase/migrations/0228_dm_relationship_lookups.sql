-- 0228: relationship-scoped profile lookups for DM (fix two get_public_profiles misuses)
--
-- get_public_profile(s) (0187) is deliberately (a) column-minimized — no
-- public_key — and (b) filtered to profile_visibility='public'. Two DM flows
-- were (mis)using it for relationship lookups where neither constraint holds:
--
--  1. Group DM key-change detection (group-actions.getGroupDetails) cast the
--     RPC result to include public_key and compared it to pubkey_at_join. Since
--     0187 never returns public_key, keyChanged was ALWAYS false — the
--     "⚠ a member's key changed" MITM/device-swap banner was permanently dead.
--
--  2. The blocked-users list (block-actions.listBlockedUsers) resolved blocked
--     ids via get_public_profiles, which drops anyone with a non-public profile
--     — so those blocked users vanished from the list and could never be
--     unblocked.
--
-- Fix: two purpose-built SECURITY DEFINER RPCs, each scoped to an EXISTING
-- relationship (co-participant / blocker), so neither the public_key nor the
-- ignore-visibility behavior can be abused for enumeration. Public-safe columns
-- only (public_key is a shareable crypto key; username/state are public identity).
--
-- Rollback: drop the two functions.

-- (1) Current public_key of every participant in a conversation the CALLER is
--     in. For E2E group key-change detection only.
create or replace function public.get_dm_member_public_keys(p_conversation_id uuid)
returns table (id uuid, public_key text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.public_key
    from public.dm_participants dp
    join public.profiles p on p.id = dp.user_id
   where dp.conversation_id = p_conversation_id
     and exists (
       select 1
         from public.dm_participants me
        where me.conversation_id = p_conversation_id
          and me.user_id = auth.uid()
     );
$$;

-- (2) Public-safe handle/state for the CALLER's OWN blocked users, ignoring
--     profile_visibility (you blocked them; you must be able to see + unblock
--     them even if they later made their profile non-public). Never returns
--     full_name/email.
create or replace function public.get_my_blocked_profiles()
returns table (id uuid, username text, state text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username, p.state, b.created_at
    from public.user_blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid();
$$;

revoke all on function public.get_dm_member_public_keys(uuid) from public, anon;
revoke all on function public.get_my_blocked_profiles() from public, anon;
grant execute on function public.get_dm_member_public_keys(uuid) to authenticated;
grant execute on function public.get_my_blocked_profiles() to authenticated;

comment on function public.get_dm_member_public_keys is
  'E2E key-change detection: current public_key per participant of a conversation the caller belongs to (co-participant scoped, SECURITY DEFINER).';
comment on function public.get_my_blocked_profiles is
  'The calling user''s own blocked users, public-safe columns only, ignoring profile_visibility so a non-public blocked user can still be unblocked.';
