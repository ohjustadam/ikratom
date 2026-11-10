-- 0319: profiles owner policies apply to signed-in users only.
--
-- WHY: 0310 revoked EXECUTE on is_owner() from anon, but recreated the two
-- profiles owner policies without `to authenticated` (its other owner
-- policies have it). Postgres evaluates every applicable policy, so ANY
-- profiles query by an anonymous visitor now errors with "permission denied
-- for function is_owner" instead of returning no rows. Signup runs as anon (a
-- new member has no session until they confirm), so from 2026-11-05 every new
-- member saw "Couldn't set username: permission denied for function is_owner"
-- after their account had been created, and kept signing up again.
--
-- Proven in a forced-rollback block on prod before writing this: with the
-- change, anon SELECT returns 0 rows and anon UPDATE matches 0 rows, both with
-- no error, and the owner still reads every profile.
--
-- ROLLBACK: recreate both policies without `to authenticated`, as in 0310.

drop policy if exists profiles_owner_read_all on public.profiles;
create policy profiles_owner_read_all on public.profiles
  for select to authenticated using (public.is_owner(auth.uid()));

drop policy if exists profiles_owner_update_all on public.profiles;
create policy profiles_owner_update_all on public.profiles
  for update to authenticated using (public.is_owner(auth.uid()));
