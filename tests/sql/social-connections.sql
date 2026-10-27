-- Connections suite (B4b slice c, migration 0287). Same contract as the other
-- social suites: one DO block as postgres, ALWAYS raises, so it rolls back.
--   SOCIAL_CONNECTIONS_OK checks=<n>  /  SOCIAL_CONNECTIONS_FAIL <labels>
--
-- Cast: a = the member everyone connects to   b, d = members
--       c = private and never discoverable (no settings row → only_me)
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  r record;
  cnt int;
  ok boolean;
  txt text;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select x, 'social-conn-' || x || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, c, d]) x;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14), profile_visibility = 'public'
   where id in (a, b, c, d);
  update public.profiles set profile_visibility = 'private' where id = c;
  insert into public.notification_preferences (user_id, notify_community) values (d, false)
    on conflict (user_id) do update set notify_community = false;

  -- ---- anon cannot touch the graph ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  ok := false;
  begin
    perform public.request_connection(a);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:request'; end if;
  execute 'reset role';

  -- ---- b asks a ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.request_connection(a) is distinct from 'pending_out' then fails := fails || ' b:request'; end if;
  n := n + 1; if public.request_connection(a) is distinct from 'pending_out' then fails := fails || ' b:request-idempotent'; end if;
  n := n + 1; if public.request_connection(c) is distinct from 'unavailable' then fails := fails || ' b:request-hidden-member'; end if;
  n := n + 1; if public.request_connection(b) is distinct from 'unavailable' then fails := fails || ' b:request-self'; end if;
  n := n + 1; if public.request_connection(gen_random_uuid()) is distinct from 'unavailable' then fails := fails || ' b:request-nobody'; end if;
  n := n + 1; if public.respond_connection(a, true) is distinct from 'none' then fails := fails || ' b:respond-own-request'; end if;
  execute 'reset role';
  select count(*) into cnt from public.notifications where user_id = a and kind = 'connection_request';
  n := n + 1; if cnt <> 1 then fails := fails || ' notify:request'; end if;

  -- ---- a accepts ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  select * into r from public.get_my_connections();
  n := n + 1; if r.other_id is distinct from b or r.direction <> 'in' or r.status <> 'pending' then fails := fails || ' a:incoming'; end if;
  n := n + 1; if public.respond_connection(b, true) is distinct from 'friends' then fails := fails || ' a:accept'; end if;
  execute 'reset role';
  select count(*) into cnt from public.notifications where user_id = b and kind = 'connection_accepted';
  n := n + 1; if cnt <> 1 then fails := fails || ' notify:accepted'; end if;

  -- ---- friend lists follow friends_audience (default friends) ----
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_profile_friends(a, 24);
  n := n + 1; if cnt <> 0 then fails := fails || ' d:friends-list-leak'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select relationship into txt from public.get_profile_view(a);
  n := n + 1; if txt is distinct from 'friends' then fails := fails || ' b:relationship'; end if;
  select count(*) into cnt from public.get_profile_friends(a, 24);
  n := n + 1; if cnt <> 1 then fails := fails || ' b:friends-list'; end if;
  execute 'reset role';

  -- a opens the list to members; c (a friend, not discoverable) stays out of it
  insert into public.profile_social (user_id, friends_audience) values (a, 'members');
  insert into public.member_connections (requester_id, addressee_id, status, responded_at) values (c, a, 'accepted', now());
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_profile_friends(a, 24);
  n := n + 1; if cnt <> 1 then fails := fails || ' d:members-list'; end if;
  select count(*) into cnt from public.get_profile_friends(a, 24) where id = c;
  n := n + 1; if cnt <> 0 then fails := fails || ' d:hidden-friend-leak'; end if;

  -- d asks a; d has community notifications off, a does not
  n := n + 1; if public.request_connection(a) is distinct from 'pending_out' then fails := fails || ' d:request'; end if;
  execute 'reset role';

  -- ---- a: decline d, block b ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.respond_connection(d, false) is distinct from 'declined' then fails := fails || ' a:decline'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (a, b);
  -- a asks d; asking back accepts
  n := n + 1; if public.request_connection(d) is distinct from 'pending_out' then fails := fails || ' a:request-d'; end if;
  execute 'reset role';
  select count(*) into cnt from public.member_connections
   where (requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a);
  n := n + 1; if cnt <> 0 then fails := fails || ' block-drops-connection'; end if;
  select count(*) into cnt from public.notifications where user_id = d and kind like 'connection_%';
  n := n + 1; if cnt <> 0 then fails := fails || ' notify:opt-out-ignored'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.request_connection(a) is distinct from 'unavailable' then fails := fails || ' b:request-blocked'; end if;
  select count(*) into cnt from public.get_my_connections();
  n := n + 1; if cnt <> 0 then fails := fails || ' b:graph-after-block'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.request_connection(a) is distinct from 'friends' then fails := fails || ' d:mutual-accepts'; end if;
  n := n + 1; if not public.remove_connection(a) then fails := fails || ' d:unfriend'; end if;
  n := n + 1; if public.remove_connection(a) then fails := fails || ' d:unfriend-twice'; end if;
  select count(*) into cnt from public.get_my_connections();
  n := n + 1; if cnt <> 0 then fails := fails || ' d:graph-after-remove'; end if;
  ok := false;
  begin
    delete from public.member_connections;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' d:direct-delete'; end if;
  execute 'reset role';

  if fails = '' then
    raise exception 'SOCIAL_CONNECTIONS_OK checks=%', n;
  end if;
  raise exception 'SOCIAL_CONNECTIONS_FAIL%', fails;
end;
$$;
