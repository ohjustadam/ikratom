-- 0312_coalition_ban_guard.sql
-- A group can't exist to ban kratom (owner yes, 2026-11-05; gap G2 from the
-- r/kratom work). The app refuses it first, reading the wording in context, in
-- groupBanAim() (src/lib/letter-stance.ts). The coalitions policies let an owner
-- write through the API directly, as 0309 notes, so this holds the plainest
-- forms in the database.
--
-- Narrower than the app on purpose: only a line or sentence that is nothing but
-- the ask, so it never refuses what the app allows
-- (tests/group-vendor-screen.test.ts reads these patterns and checks that).
--
-- A trigger of its own, so 0309's stays as tested. Saved rows aren't re-judged
-- until someone edits them. Both live groups pass (checked 2026-11-05).
-- Rollback:
--   drop trigger if exists coalition_ban_guard on public.coalitions;
--   drop function if exists public.coalition_ban_guard();

create or replace function public.coalition_ban_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t text := coalesce(new.name, '') || E'\n' || coalesce(new.description, '') || E'\n' || coalesce(new.featured_note, '');
begin
  if t ~* '(?n)(^|[.!])\s*(ban|outlaw|prohibit|criminali[sz]e)\s+(natural\s+|leaf\s+|raw\s+|plant\s+|all\s+)?kratom(\s+(now|today))?\s*([.!]|$)'
     or t ~* '(?n)^\s*(the\s+)?(?!(plans|clans|means|loans|scans|spans|beans|deans)\M)([a-z]+ans|citizens|residents|voters|parents|moms|mothers|dads|fathers|families|neighbors|people|doctors|physicians|nurses|teachers|coalition|alliance|committee)\s+(to\s+(ban|outlaw|prohibit|criminali[sz]e)\s+kratom|for\s+(a|the)\s+kratom\s+ban)\s*$' then
    raise exception 'A group can''t ask to ban kratom.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.coalition_ban_guard() from public, anon, authenticated;

drop trigger if exists coalition_ban_guard on public.coalitions;
create trigger coalition_ban_guard
  before insert or update of name, description, featured_note on public.coalitions
  for each row execute function public.coalition_ban_guard();
