-- 0168_backfill_usernames.sql
--
-- Public anonymity hard rule: users are shown by @username only in all
-- public areas — never real name / email. The render layer (publicHandle)
-- refuses to fall back to full_name, so any account WITHOUT a username
-- would show as a bare "Member". Backfill a neutral handle for every
-- such account so nobody is nameless and nobody's real name leaks.
--
-- Handle = 'member_' + 10 hex chars of the user's uuid. Neutral by
-- design (NOT derived from email/full_name, which would re-leak the
-- identity we're hiding). Matches the 0057 constraint ^[a-z0-9_]{3,30}$
-- (member_ + 10 hex = 17 chars) and is unique (uuid-derived). Users can
-- change it anytime in profile settings.
--
-- Rollback: none needed — purely additive backfill of a previously-null
-- column. (To undo: UPDATE profiles SET username = NULL WHERE username
-- LIKE 'member\_%' ESCAPE '\' — but there's no reason to.)

UPDATE public.profiles
SET username = 'member_' || substr(replace(id::text, '-', ''), 1, 10)
WHERE username IS NULL
   OR length(trim(username)) = 0;

-- Username-only DM recipient search. profiles SELECT RLS is self/admin
-- only, so a direct client query can't find other users — and that's
-- correct (no browsing the member list). This SECURITY DEFINER function
-- lets a signed-in user look someone up by the handle they chose to
-- make public, returning ONLY the columns needed to start an encrypted
-- conversation. Never exposes full_name or email.
create or replace function public.search_users_by_username(p_q text, p_limit int default 10)
returns table (id uuid, username text, state text, public_key text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username, p.state, p.public_key
  from public.profiles p
  where p.public_key is not null
    and p.username is not null
    and p.username ilike (lower(regexp_replace(coalesce(p_q, ''), '^@', '')) || '%')
    and p.id <> auth.uid()
  order by p.username
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke all on function public.search_users_by_username(text, int) from public;
grant execute on function public.search_users_by_username(text, int) to authenticated;
