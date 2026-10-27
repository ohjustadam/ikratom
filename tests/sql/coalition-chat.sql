-- Group chat suite (migration 0291). Same contract as the social suites: one
-- DO block as postgres that ALWAYS raises, so it rolls back with zero residue.
--   COALITION_CHAT_OK checks=<n>  /  COALITION_CHAT_FAIL <labels>
--
-- Cast: a = the group's organizer   b = a member   x = not in the group
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  grp uuid;
  msg_a uuid;
  msg_b uuid;
  cnt int;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select u, 'chat-rls-' || u || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, x]) u;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14) where id in (a, b, x);
  insert into public.coalitions (slug, name, owner_id) values ('zz-chat-' || substr(replace(a::text, '-', ''), 1, 10), 'Chat test', a) returning id into grp;
  insert into public.coalition_members (coalition_id, user_id, role) values (grp, a, 'owner'), (grp, b, 'member');
  insert into public.coalition_chat_messages (coalition_id, user_id, body) values (grp, a, 'hello group') returning id into msg_a;

  -- ---- shape ----
  n := n + 1; if (select relreplident from pg_class where oid = 'public.coalition_chat_messages'::regclass) <> 'f' then fails := fails || ' replica-identity'; end if;
  n := n + 1; if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'coalition_chat_messages') then fails := fails || ' not-in-realtime'; end if;
  n := n + 1; if has_table_privilege('authenticated', 'public.coalition_chat_messages', 'UPDATE') then fails := fails || ' update-granted'; end if;
  n := n + 1; if has_table_privilege('anon', 'public.coalition_chat_messages', 'SELECT') then fails := fails || ' anon-select-granted'; end if;

  -- ---- b, a member ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  insert into public.coalition_chat_messages (coalition_id, user_id, body) values (grp, b, 'hi from b') returning id into msg_b;
  select count(*) into cnt from public.coalition_chat_messages where coalition_id = grp;
  n := n + 1; if cnt <> 2 then fails := fails || ' b:reads-' || cnt; end if;
  ok := false;
  begin
    insert into public.coalition_chat_messages (coalition_id, user_id, body) values (grp, a, 'forged as a');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' b:forged-author'; end if;
  delete from public.coalition_chat_messages where id = msg_a;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' b:deleted-others'; end if;
  n := n + 1; if not public.report_content('group_chat_message', msg_a::text, 'spam', null) then fails := fails || ' b:cannot-report'; end if;
  n := n + 1; if public.report_content('group_chat_message', msg_b::text, 'spam', null) then fails := fails || ' b:reported-own'; end if;
  execute 'reset role';

  -- ---- x, not in the group ----
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', x::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.coalition_chat_messages where coalition_id = grp;
  n := n + 1; if cnt <> 0 then fails := fails || ' x:reads-' || cnt; end if;
  ok := false;
  begin
    insert into public.coalition_chat_messages (coalition_id, user_id, body) values (grp, x, 'let me in');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' x:posted'; end if;
  delete from public.coalition_chat_messages where coalition_id = grp;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' x:deleted'; end if;
  n := n + 1; if public.report_content('group_chat_message', msg_a::text, 'spam', null) then fails := fails || ' x:reported'; end if;
  execute 'reset role';

  -- ---- anon ----
  execute 'set local role anon';
  ok := false;
  begin
    select count(*) into cnt from public.coalition_chat_messages;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:reads'; end if;
  execute 'reset role';

  -- ---- a, the organizer, removes b's line ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  delete from public.coalition_chat_messages where id = msg_b;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 1 then fails := fails || ' a:cannot-moderate'; end if;
  execute 'reset role';

  -- ---- what landed ----
  select count(*) into cnt from public.coalition_chat_messages where id = msg_a;
  n := n + 1; if cnt <> 1 then fails := fails || ' msg-a-gone'; end if;
  select count(*) into cnt from public.content_reports where target_type = 'group_chat_message' and target_owner_id = a;
  n := n + 1; if cnt <> 1 then fails := fails || ' report-rows-' || cnt; end if;

  if fails = '' then
    raise exception 'COALITION_CHAT_OK checks=%', n;
  end if;
  raise exception 'COALITION_CHAT_FAIL%', fails;
end;
$$;
