-- Generic report system suite (migration 0288). Same contract as the other
-- social suites: one DO block as postgres, ALWAYS raises, so it rolls back.
--   SOCIAL_REPORTS_OK checks=<n>  /  SOCIAL_REPORTS_FAIL <labels>
--
-- Cast: a = author of everything   c = reporter (member)
--       e = private + never discoverable   g = not in a's group
do $$
declare
  a uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  msg uuid;
  msg2 uuid;
  story_ok uuid;
  story_pending uuid;
  conv uuid;
  grp uuid;
  thread uuid;
  vid text;
  cnt int;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select x, 'social-rep-' || x || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, c, e, g]) x;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14), profile_visibility = 'public'
   where id in (a, c, e, g);
  update public.profiles set profile_visibility = 'private' where id = e;

  insert into public.chat_messages (user_id, room, body) values (a, 'lounge', 'hello') returning id into msg;
  insert into public.chat_messages (user_id, room, body) values (a, 'lounge', 'second') returning id into msg2;
  insert into public.kratom_stories (author_id, title, body, moderation_status) values (a, 'A test story title', 'A test story body long enough for any length check in the table.', 'approved') returning id into story_ok;
  insert into public.kratom_stories (author_id, title, body, moderation_status) values (a, 'A test story title', 'A test story body long enough for any length check in the table.', 'pending') returning id into story_pending;
  insert into public.dm_conversations default values returning id into conv;
  insert into public.dm_participants (conversation_id, user_id) values (conv, a), (conv, c);
  insert into public.coalitions (slug, name, owner_id) values ('zz-rls-' || substr(replace(a::text, '-', ''), 1, 10), 'Test group', a) returning id into grp;
  insert into public.coalition_members (coalition_id, user_id, role) values (grp, a, 'owner'), (grp, c, 'member')
    on conflict do nothing;
  insert into public.coalition_threads (coalition_id, author_id, title, body) values (grp, a, 'A test thread title', 'A test thread body for the report suite.') returning id into thread;
  select v.video_id into vid from public.community_videos v where not coalesce(v.hidden, false) limit 1;

  -- ---- anon cannot report ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  ok := false;
  begin
    perform public.report_content('profile', a::text, 'spam', null);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:report'; end if;
  execute 'reset role';

  -- ---- c reports what c can see ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c::text, true);
  execute 'set local role authenticated';
  n := n + 1; if not public.report_content('profile', a::text, 'harassment', 'note') then fails := fails || ' c:profile'; end if;
  n := n + 1; if not public.report_content('profile', a::text, 'harassment', 'again') then fails := fails || ' c:profile-repeat-ok'; end if;
  n := n + 1; if public.report_content('profile', e::text, 'spam', null) then fails := fails || ' c:hidden-profile'; end if;
  n := n + 1; if public.report_content('profile', c::text, 'spam', null) then fails := fails || ' c:own-profile'; end if;
  n := n + 1; if not public.report_content('lounge_message', msg::text, 'spam', null) then fails := fails || ' c:lounge'; end if;
  n := n + 1; if not public.report_content('story', story_ok::text, 'misinformation', null) then fails := fails || ' c:story'; end if;
  n := n + 1; if public.report_content('story', story_pending::text, 'spam', null) then fails := fails || ' c:unpublished-story'; end if;
  n := n + 1; if not public.report_content('dm_user', a::text, 'harassment', 'pasted excerpt') then fails := fails || ' c:dm-user'; end if;
  n := n + 1; if public.report_content('dm_user', g::text, 'harassment', null) then fails := fails || ' c:dm-stranger'; end if;
  n := n + 1; if not public.report_content('group_thread', thread::text, 'spam', null) then fails := fails || ' c:group-thread'; end if;
  if vid is not null then
    n := n + 1; if not public.report_content('community_video', vid, 'spam', null) then fails := fails || ' c:video'; end if;
  end if;
  n := n + 1; if public.report_content('profile', 'not-a-uuid', 'spam', null) then fails := fails || ' c:bad-id'; end if;
  n := n + 1; if public.report_content('no_such_type', a::text, 'spam', null) then fails := fails || ' c:bad-type'; end if;
  -- A reason outside the list is refused by the table, on a target c has not
  -- reported yet (a repeat report is a no-op before the check runs).
  ok := false;
  begin
    perform public.report_content('lounge_message', msg2::text, 'i hate it', null);
  exception when check_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:free-text-reason'; end if;
  n := n + 1; if public.report_content('lounge_message', gen_random_uuid()::text, 'spam', null) then fails := fails || ' c:missing-target'; end if;
  select count(*) into cnt from public.content_reports;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:reads-reports'; end if;
  ok := false;
  begin
    insert into public.content_reports (target_type, target_id, reporter_id, reason) values ('profile', a::text, c, 'spam');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:direct-insert'; end if;
  execute 'reset role';

  -- ---- g is not in the group ----
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', g::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.report_content('group_thread', thread::text, 'spam', null) then fails := fails || ' g:non-member-group'; end if;
  execute 'reset role';

  -- ---- what landed ----
  select count(*) into cnt from public.content_reports where target_type = 'profile' and target_id = a::text;
  n := n + 1; if cnt <> 1 then fails := fails || ' one-per-reporter'; end if;
  select count(*) into cnt from public.content_reports where target_owner_id = a and status = 'open';
  n := n + 1; if cnt <> 5 then fails := fails || ' owner-resolved:' || cnt; end if;
  select count(*) into cnt from public.content_reports where target_type = 'dm_user' and note = 'pasted excerpt';
  n := n + 1; if cnt <> 1 then fails := fails || ' dm-excerpt'; end if;

  if fails = '' then
    raise exception 'SOCIAL_REPORTS_OK checks=%', n;
  end if;
  raise exception 'SOCIAL_REPORTS_FAIL%', fails;
end;
$$;
