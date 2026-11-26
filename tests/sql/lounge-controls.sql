-- Lounge prefs + reactions suite (migration 0336, B8 phase 1). Same contract
-- as the social suites: one DO block as postgres that ALWAYS raises, so it
-- rolls back with zero residue.
--   LOUNGE_CONTROLS_OK checks=<n>  /  LOUNGE_CONTROLS_FAIL <labels>
--
-- Cast: a = a member   b = another member   m = a muted member
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  msg uuid;
  grp_msg_room text := 'group:zz-test';
  other_msg uuid;
  cnt int;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select u, 'lounge-rls-' || u || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, m]) u;
  update public.profiles set chat_muted_until = now() + interval '1 hour' where id = m;
  insert into public.chat_messages (user_id, room, body) values (b, 'lounge', 'hello lounge') returning id into msg;
  insert into public.chat_messages (user_id, room, body) values (b, grp_msg_room, 'not the lounge') returning id into other_msg;
  insert into public.lounge_prefs (user_id, keep_open, theme) values (b, true, 'dusk');
  insert into public.chat_reactions (message_id, user_id, emoji) values (msg, b, '👍');

  -- ---- shape ----
  n := n + 1; if (select relreplident from pg_class where oid = 'public.chat_reactions'::regclass) <> 'f' then fails := fails || ' replica-identity'; end if;
  n := n + 1; if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_reactions') then fails := fails || ' not-in-realtime'; end if;
  n := n + 1; if has_table_privilege('anon', 'public.lounge_prefs', 'SELECT') then fails := fails || ' anon-prefs-select'; end if;
  n := n + 1; if has_table_privilege('anon', 'public.chat_reactions', 'SELECT') then fails := fails || ' anon-reactions-select'; end if;
  n := n + 1; if has_table_privilege('authenticated', 'public.chat_reactions', 'UPDATE') then fails := fails || ' reactions-update-granted'; end if;
  n := n + 1; if has_table_privilege('authenticated', 'public.lounge_prefs', 'DELETE') then fails := fails || ' prefs-delete-granted'; end if;
  n := n + 1; if not has_table_privilege('authenticated', 'public.lounge_prefs', 'INSERT') then fails := fails || ' prefs-insert-missing'; end if;

  -- ---- a, a member ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';

  insert into public.lounge_prefs (user_id, text_size, easy_font) values (a, 2, true);
  select count(*) into cnt from public.lounge_prefs;
  n := n + 1; if cnt <> 1 then fails := fails || ' a:sees-prefs-' || cnt; end if;
  update public.lounge_prefs set theme = 'ocean' where user_id = b;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' a:updated-b-prefs'; end if;
  ok := false;
  begin
    insert into public.lounge_prefs (user_id) values (b);
  exception when insufficient_privilege or unique_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:wrote-b-prefs'; end if;
  ok := false;
  begin
    update public.lounge_prefs set theme = 'neon' where user_id = a;
  exception when check_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:bad-theme'; end if;

  insert into public.chat_reactions (message_id, user_id, emoji) values (msg, a, '❤️');
  select count(*) into cnt from public.chat_reactions where message_id = msg;
  n := n + 1; if cnt <> 2 then fails := fails || ' a:reads-reactions-' || cnt; end if;
  ok := false;
  begin
    insert into public.chat_reactions (message_id, user_id, emoji) values (msg, b, '😂');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:forged-reactor'; end if;
  ok := false;
  begin
    insert into public.chat_reactions (message_id, user_id, emoji) values (msg, a, '🍆');
  exception when check_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:off-list-emoji'; end if;
  ok := false;
  begin
    insert into public.chat_reactions (message_id, user_id, emoji) values (other_msg, a, '👍');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:reacted-outside-lounge'; end if;
  delete from public.chat_reactions where user_id = b;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' a:removed-b-reaction'; end if;
  delete from public.chat_reactions where user_id = a;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 1 then fails := fails || ' a:cannot-remove-own'; end if;
  execute 'reset role';

  -- ---- m, muted ----
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', m::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    insert into public.chat_reactions (message_id, user_id, emoji) values (msg, m, '👍');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' m:muted-reacted'; end if;
  execute 'reset role';

  -- ---- anon ----
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  ok := false;
  begin
    select count(*) into cnt from public.chat_reactions;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:read-reactions'; end if;
  ok := false;
  begin
    select count(*) into cnt from public.lounge_prefs;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:read-prefs'; end if;
  execute 'reset role';

  -- ---- cascade: deleting a message takes its reactions ----
  delete from public.chat_messages where id = msg;
  select count(*) into cnt from public.chat_reactions where message_id = msg;
  n := n + 1; if cnt <> 0 then fails := fails || ' cascade-left-' || cnt; end if;

  if fails = '' then
    raise exception 'LOUNGE_CONTROLS_OK checks=%', n;
  end if;
  raise exception 'LOUNGE_CONTROLS_FAIL%', fails;
end;
$$;
