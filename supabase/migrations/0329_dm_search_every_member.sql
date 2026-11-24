-- 0329_dm_search_every_member.sql
--
-- WHY (member report 2026-11-23): "she gets the same screen trying to search me
-- for DMs." Private messages have never been used: dm_conversations is EMPTY.
-- search_users_by_username (0234) returned only members who already had an
-- encryption key, and a key is made only when a member opens /messages on a
-- device. 64 of 75 members have none, so search found almost nobody and said
-- "No users matched", which reads as "that person doesn't exist".
--
-- FIX:
--   1. Search returns every discoverable member, with public_key null when
--      they have not opened Messages yet. Substring match, prefix hits first,
--      wildcards escaped. Blocked pairs (either direction) are left out.
--      The three callers already handle a null key (the 1:1 picker explains
--      it; the group pickers filter those rows out).
--   2. request_dm_setup(target): the "Let them know" button. One in-app
--      notification to a keyless member: "@you wants to message you", linking
--      to /messages/new?to=<you>, which makes their key and pre-picks you.
--      At most one per pair per 7 days, 5 per sender per hour, never to
--      someone who blocked you or turned community notifications off.
--
-- Rollback:
--   drop function if exists public.request_dm_setup(uuid);
--   then re-run the search_users_by_username body from 0234.

create or replace function public.search_users_by_username(p_q text, p_limit integer default 10)
returns table(id uuid, username text, state text, public_key text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (
    select replace(replace(replace(lower(regexp_replace(coalesce(p_q, ''), '^@', '')), '\', '\\'), '%', '\%'), '_', '\_') as s
  )
  select p.id, p.username, p.state, p.public_key
  from public.profiles p, q
  where length(q.s) >= 2
    and p.username is not null
    and p.profile_visibility = 'public'
    and p.username ilike '%' || q.s || '%'
    and p.id <> auth.uid()
    and not exists (
      select 1 from public.user_blocks b
       where (b.blocker_id = p.id and b.blocked_id = auth.uid())
          or (b.blocker_id = auth.uid() and b.blocked_id = p.id)
    )
  order by (p.username ilike q.s || '%') desc, (p.public_key is not null) desc, p.username
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke all on function public.search_users_by_username(text, integer) from public, anon;
grant execute on function public.search_users_by_username(text, integer) to authenticated, service_role;

create or replace function public.request_dm_setup(p_target uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_handle text;
  v_key text;
  v_link text;
begin
  if v_me is null then return 'signin'; end if;
  if p_target is null or p_target = v_me then return 'not_found'; end if;

  select pr.public_key into v_key
    from public.profiles pr
   where pr.id = p_target and pr.profile_visibility = 'public' and pr.username is not null;
  if not found then return 'not_found'; end if;
  if v_key is not null then return 'ready'; end if;

  if exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = p_target and b.blocked_id = v_me)
        or (b.blocker_id = v_me and b.blocked_id = p_target)
  ) then
    return 'not_found';
  end if;

  v_link := '/messages/new?to=' || v_me::text;
  if exists (
    select 1 from public.notifications n
     where n.user_id = p_target and n.kind = 'dm_request' and n.link = v_link
       and n.created_at > now() - interval '7 days'
  ) then
    return 'already';
  end if;
  if (select count(*) from public.notifications n
       where n.kind = 'dm_request' and n.link = v_link
         and n.created_at > now() - interval '1 hour') >= 5 then
    return 'rate';
  end if;

  -- A muted member is told nothing, and the sender sees the same answer.
  if exists (select 1 from public.notification_preferences np where np.user_id = p_target and np.notify_community = false) then
    return 'sent';
  end if;

  select '@' || coalesce(pr.username, 'member') into v_handle from public.profiles pr where pr.id = v_me;
  insert into public.notifications (user_id, kind, title, body, link)
  values (
    p_target,
    'dm_request',
    v_handle || ' wants to message you',
    'Open this once to turn on private messages, then you can talk.',
    v_link
  );
  return 'sent';
end;
$$;

revoke all on function public.request_dm_setup(uuid) from public, anon;
grant execute on function public.request_dm_setup(uuid) to authenticated, service_role;
