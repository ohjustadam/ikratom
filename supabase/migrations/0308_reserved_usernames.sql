-- 0308_reserved_usernames.sql
--
-- Intent (owner ask 2026-11-03, for the r/kratom moderators): nobody may pass
-- as iKratom staff. Signup refused a dozen exact names ("admin", "support"),
-- but "ikratom_support", "admin_jane" or "official_ikratom" went through, and a
-- member could change their handle to anything through the API, skipping
-- signup's check entirely. Members only ever see @username, so a staff-looking
-- handle is the one way to impersonate the team in chat, DMs and groups.
--
--   is_reserved_username(text)  one rule, used by signup (src/modules/auth/actions.ts)
--                               and by the trigger below. A handle is reserved when
--     - it reads "ikratom" at the start or after "_" (i_kratom, 1kratom too);
--     - it contains "moderator" or "official", or "admin" as its own word;
--     - every word in it is a staff word ("support_team", "help_desk", "mod").
--   trg_profiles_reserved_username  refuses a member CHANGING their handle to a
--     reserved one. Service jobs (no member session), admins and the owner are
--     not refused. Inserts are not checked: placeholders are member_<hex>.
--
-- No existing username matches (checked 2026-11-03, 54 profiles).
--
-- Rollback:
--   drop trigger if exists trg_profiles_reserved_username on public.profiles;
--   drop function if exists public.guard_reserved_username();
--   drop function if exists public.is_reserved_username(text);

create or replace function public.is_reserved_username(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  with n as (
    select translate(lower(coalesce(p, '')), '013457', 'oieast') as leet,
           regexp_replace(lower(coalesce(p, '')), '[0-9]+', '_', 'g') as plain
  )
  select leet ~ '(^|_)i_?kratom'
      or leet ~ 'moderator'
      or leet ~ 'official'
      or leet ~ '(^|_)admin' or leet ~ 'admin(s|istrator)?($|_)'
      or coalesce((
           select bool_and(w = any (array[
             'ikratom', 'admin', 'admins', 'administrator', 'mod', 'mods', 'moderator', 'official',
             'staff', 'support', 'team', 'help', 'helpdesk', 'desk', 'owner', 'system', 'root',
             'security', 'safety', 'trust', 'verify', 'verified', 'account', 'accounts', 'service',
             'notifications', 'noreply', 'no', 'reply', 'info', 'hello', 'contact', 'anonymous', 'anon']))
             from unnest(string_to_array(plain, '_')) w
            where w <> ''), false)
    from n;
$$;

revoke all on function public.is_reserved_username(text) from public;
grant execute on function public.is_reserved_username(text) to anon, authenticated, service_role;

comment on function public.is_reserved_username(text) is
  'True for staff-looking handles (0308): ikratom at a word start, moderator, official, admin as a word, or every word a staff word. Used by signup and trg_profiles_reserved_username.';

create or replace function public.guard_reserved_username()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return new;  -- service jobs and the SQL console
  end if;
  if new.username is not distinct from old.username or not public.is_reserved_username(new.username) then
    return new;
  end if;
  if exists (select 1 from public.profiles p
              where p.id = auth.uid() and (coalesce(p.is_admin, false) or coalesce(p.is_owner, false))) then
    return new;
  end if;
  raise exception 'That username is reserved.' using errcode = '22023';
end;
$$;

revoke all on function public.guard_reserved_username() from public, anon, authenticated;

drop trigger if exists trg_profiles_reserved_username on public.profiles;
create trigger trg_profiles_reserved_username
  before update of username on public.profiles
  for each row execute function public.guard_reserved_username();
