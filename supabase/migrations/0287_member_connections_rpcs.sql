-- ============================================================
-- 0287 — Connections ("friends"): request, accept, decline, remove, block
-- ============================================================
-- B4b slice (c), private/plans/SOCIAL_PLAYBOOK.md §3. member_connections
-- (0285) has no INSERT/UPDATE/DELETE grant: every write goes through these
-- SECURITY DEFINER RPCs, so the rules live in one place.
--
--   request_connection(target)     → 'pending_out' | 'friends' (they had asked you:
--                                    asking back accepts) | 'unavailable'
--   respond_connection(requester, accept) → 'friends' | 'declined' | 'none'
--   remove_connection(other)       → cancel a request, decline, or unfriend
--   get_my_connections()           → your friends + requests in and out
--   get_profile_friends(owner)     → a member's friends, if friends_audience allows
--
-- 'unavailable' covers: yourself, a member who does not exist, a block either
-- way, and a member whose profile you cannot see who is not discoverable. They
-- are deliberately indistinguishable, so a request can't probe for a member.
--
-- A block (user_blocks insert, from any code path) deletes the pair's
-- connection in a trigger. Requests and acceptances leave an in-app
-- notification (kind connection_request / connection_accepted) unless the
-- recipient turned community notifications off; the existing push sweep
-- (fanoutPushNotifications) delivers them with its rate cap and quiet hours.
--
-- Rollback:
--   drop trigger if exists trg_user_blocks_drop_connection on public.user_blocks;
--   drop function if exists public.drop_connection_on_block();
--   drop function if exists public.get_profile_friends(uuid, integer);
--   drop function if exists public.get_my_connections();
--   drop function if exists public.remove_connection(uuid);
--   drop function if exists public.respond_connection(uuid, boolean);
--   drop function if exists public.request_connection(uuid);
--   drop function if exists public.notify_connection(uuid, uuid, text);

-- ---- notification helper (internal) ----------------------------------------
create or replace function public.notify_connection(p_to uuid, p_from uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_handle text;
begin
  if exists (select 1 from public.notification_preferences np where np.user_id = p_to and np.notify_community = false) then
    return;
  end if;
  select '@' || coalesce(pr.username, 'member') into v_handle from public.profiles pr where pr.id = p_from;
  insert into public.notifications (user_id, kind, title, body, link)
  values (
    p_to,
    p_kind,
    case p_kind
      when 'connection_request' then v_handle || ' wants to connect'
      else v_handle || ' accepted your request'
    end,
    case p_kind
      when 'connection_request' then 'Accept to share what you show your friends.'
      else 'You are now connected.'
    end,
    case p_kind when 'connection_request' then '/account/connections' else '/profile/' || p_from::text end
  );
exception when others then
  -- A notification must never block the connection itself.
  raise warning 'notify_connection failed: %', sqlerrm;
end;
$$;

revoke all on function public.notify_connection(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.notify_connection(uuid, uuid, text) to service_role;

-- ---- request ----------------------------------------------------------------
create or replace function public.request_connection(p_target uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_vis text;
  v_aud text;
  v_existing record;
begin
  if v_me is null then
    raise exception 'sign in to connect';
  end if;
  if p_target is null or p_target = v_me then
    return 'unavailable';
  end if;

  select pr.profile_visibility, coalesce(ps.profile_audience, public.default_profile_audience(pr.profile_visibility))
    into v_vis, v_aud
    from public.profiles pr
    left join public.profile_social ps on ps.user_id = pr.id
   where pr.id = p_target;
  if not found then
    return 'unavailable';
  end if;
  if exists (select 1 from public.user_blocks b
              where (b.blocker_id = p_target and b.blocked_id = v_me)
                 or (b.blocker_id = v_me and b.blocked_id = p_target)) then
    return 'unavailable';
  end if;
  if v_vis <> 'public' and not public.can_view_audience(p_target, v_aud) then
    return 'unavailable';
  end if;

  select c.* into v_existing
    from public.member_connections c
   where (c.requester_id = v_me and c.addressee_id = p_target)
      or (c.requester_id = p_target and c.addressee_id = v_me);
  if found then
    if v_existing.status = 'accepted' then
      return 'friends';
    end if;
    if v_existing.requester_id = v_me then
      return 'pending_out';
    end if;
    -- They asked you first: asking back is accepting.
    update public.member_connections
       set status = 'accepted', responded_at = now()
     where requester_id = p_target and addressee_id = v_me;
    perform public.notify_connection(p_target, v_me, 'connection_accepted');
    return 'friends';
  end if;

  -- Anti-spam backstop under the per-day rate limit in the server action.
  if (select count(*) from public.member_connections c where c.requester_id = v_me and c.status = 'pending') >= 100 then
    raise exception 'too many pending requests';
  end if;

  insert into public.member_connections (requester_id, addressee_id, status) values (v_me, p_target, 'pending');
  perform public.notify_connection(p_target, v_me, 'connection_request');
  return 'pending_out';
end;
$$;

-- ---- respond ----------------------------------------------------------------
create or replace function public.respond_connection(p_requester uuid, p_accept boolean)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;
  if not exists (select 1 from public.member_connections c
                  where c.requester_id = p_requester and c.addressee_id = v_me and c.status = 'pending') then
    return 'none';
  end if;
  if coalesce(p_accept, false) then
    update public.member_connections
       set status = 'accepted', responded_at = now()
     where requester_id = p_requester and addressee_id = v_me;
    perform public.notify_connection(p_requester, v_me, 'connection_accepted');
    return 'friends';
  end if;
  -- Declining is silent: the requester is not told.
  delete from public.member_connections where requester_id = p_requester and addressee_id = v_me;
  return 'declined';
end;
$$;

-- ---- remove (cancel / decline / unfriend) -------------------------------------
create or replace function public.remove_connection(p_other uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_n int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;
  delete from public.member_connections c
   where (c.requester_id = v_me and c.addressee_id = p_other)
      or (c.requester_id = p_other and c.addressee_id = v_me);
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---- reads --------------------------------------------------------------------
-- Your own graph. Handles of people you are connected to (or who asked you)
-- are shown even if they are not discoverable: the relationship is mutual
-- knowledge already. Blocked pairs never appear (the trigger deletes them).
create or replace function public.get_my_connections()
returns table (other_id uuid, username text, avatar_url text, status text, direction text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.username, public.visible_avatar_url(o.id), c.status,
         case when c.requester_id = auth.uid() then 'out' else 'in' end,
         coalesce(c.responded_at, c.created_at)
    from public.member_connections c
    join public.profiles o on o.id = case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
   where auth.uid() in (c.requester_id, c.addressee_id)
   order by coalesce(c.responded_at, c.created_at) desc;
$$;

-- A member's friends, as the viewer may see them: only when the owner's
-- friends_audience allows, and only friends who are discoverable themselves
-- (or are the viewer), minus anyone in a block with the viewer.
create or replace function public.get_profile_friends(p_owner uuid, p_limit integer default 24)
returns table (id uuid, username text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.username, public.visible_avatar_url(f.id)
    from public.member_connections c
    join public.profiles f on f.id = case when c.requester_id = p_owner then c.addressee_id else c.requester_id end
    left join public.profile_social ps on ps.user_id = p_owner
   where c.status = 'accepted'
     and p_owner in (c.requester_id, c.addressee_id)
     and public.can_view_audience(p_owner, coalesce(ps.friends_audience, 'friends'))
     and (f.id = auth.uid() or f.profile_visibility = 'public')
     and (auth.uid() is null or not exists (
           select 1 from public.user_blocks b
            where (b.blocker_id = f.id and b.blocked_id = auth.uid())
               or (b.blocker_id = auth.uid() and b.blocked_id = f.id)))
   order by c.responded_at desc nulls last
   limit greatest(1, least(coalesce(p_limit, 24), 200));
$$;

revoke all on function public.request_connection(uuid) from public, anon;
revoke all on function public.respond_connection(uuid, boolean) from public, anon;
revoke all on function public.remove_connection(uuid) from public, anon;
revoke all on function public.get_my_connections() from public, anon;
revoke all on function public.get_profile_friends(uuid, integer) from public;
grant execute on function public.request_connection(uuid) to authenticated, service_role;
grant execute on function public.respond_connection(uuid, boolean) to authenticated, service_role;
grant execute on function public.remove_connection(uuid) to authenticated, service_role;
grant execute on function public.get_my_connections() to authenticated, service_role;
grant execute on function public.get_profile_friends(uuid, integer) to anon, authenticated, service_role;

-- ---- a block ends the connection ------------------------------------------
create or replace function public.drop_connection_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.member_connections c
   where (c.requester_id = new.blocker_id and c.addressee_id = new.blocked_id)
      or (c.requester_id = new.blocked_id and c.addressee_id = new.blocker_id);
  return new;
end;
$$;

revoke all on function public.drop_connection_on_block() from public, anon, authenticated;

drop trigger if exists trg_user_blocks_drop_connection on public.user_blocks;
create trigger trg_user_blocks_drop_connection
  after insert on public.user_blocks
  for each row execute function public.drop_connection_on_block();
