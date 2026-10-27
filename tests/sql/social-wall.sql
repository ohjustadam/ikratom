-- Profile wall suite (migration 0292). Same contract as the other social
-- suites: one DO block as postgres, ALWAYS raises, so it rolls back.
--   SOCIAL_WALL_OK checks=<n>  /  SOCIAL_WALL_FAIL <labels>
--
-- Cast: a = wall owner   b = a's friend   c = member, not a friend
--       d = blocked by a  e = another member (third reporter)   anon
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  ph1 uuid := gen_random_uuid();
  ph2 uuid := gen_random_uuid();
  p_members uuid;
  p_friends uuid;
  p_only uuid;
  p_photo uuid;
  p_b uuid;
  cm1 uuid;
  v_ph uuid;
  v_po uuid;
  v_txt text;
  cnt int;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select x, 'social-wall-' || x || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, c, d, e]) x;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14), profile_visibility = 'public'
   where id in (a, b, c, d, e);
  insert into public.member_connections (requester_id, addressee_id, status) values (a, b, 'accepted');
  insert into public.user_blocks (blocker_id, blocked_id) values (a, d);
  insert into public.member_photos (id, owner_id, kind, r2_key, content_type, bytes, width, height, audience)
  values (ph1, a, 'wall', 'photos/' || a || '/' || ph1 || '.jpg', 'image/jpeg', 100, 10, 10, 'only_me'),
         (ph2, c, 'wall', 'photos/' || c || '/' || ph2 || '.jpg', 'image/jpeg', 100, 10, 10, 'only_me');

  -- ---- a posts on their own wall ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  p_members := public.create_wall_post(a, 'members post');
  p_friends := public.create_wall_post(a, 'friends post', null, 'friends');
  p_only := public.create_wall_post(a, 'only me post', null, 'only_me');
  p_photo := public.create_wall_post(a, 'photo post', ph1);
  n := n + 1; if p_members is null or p_friends is null or p_only is null or p_photo is null then fails := fails || ' a:post'; end if;
  n := n + 1; if public.create_wall_post(a, '   ') is not null then fails := fails || ' a:blank'; end if;
  n := n + 1; if public.create_wall_post(a, repeat('x', 2001)) is not null then fails := fails || ' a:too-long'; end if;
  n := n + 1; if public.create_wall_post(a, 'reuse', ph1) is not null then fails := fails || ' a:photo-reuse'; end if;
  n := n + 1; if public.create_wall_post(a, 'theirs', ph2) is not null then fails := fails || ' a:others-photo'; end if;
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 4 then fails := fails || ' a:sees-all:' || cnt; end if;
  select count(*) into cnt from public.get_profile_photos(a) where kind = 'wall';
  n := n + 1; if cnt <> 0 then fails := fails || ' a:wall-photo-in-album'; end if;
  execute 'reset role';

  -- ---- b, a friend, may post (but not pick an audience) ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.wall_access(a) <> 'post' then fails := fails || ' b:access'; end if;
  p_b := public.create_wall_post(a, 'hello from b');
  n := n + 1; if p_b is null then fails := fails || ' b:post'; end if;
  n := n + 1; if public.create_wall_post(a, 'aud', null, 'public') is not null then fails := fails || ' b:audience'; end if;
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 4 then fails := fails || ' b:sees:' || cnt; end if;
  execute 'reset role';

  -- ---- c, a member but not a friend, may read and comment ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.wall_access(a) <> 'view' then fails := fails || ' c:access'; end if;
  n := n + 1; if public.create_wall_post(a, 'c post') is not null then fails := fails || ' c:post'; end if;
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 3 then fails := fails || ' c:sees:' || cnt; end if;
  select count(*) into cnt from public.wall_posts where wall_owner_id = a;
  n := n + 1; if cnt <> 3 then fails := fails || ' c:rls:' || cnt; end if;
  select count(*) into cnt from public.get_media_object(ph1);
  n := n + 1; if cnt <> 1 then fails := fails || ' c:photo'; end if;
  cm1 := public.create_wall_comment(p_members, 'nice');
  n := n + 1; if cm1 is null then fails := fails || ' c:comment'; end if;
  n := n + 1; if public.create_wall_comment(p_friends, 'x') is not null then fails := fails || ' c:comment-hidden'; end if;
  select count(*) into cnt from public.delete_wall_post(p_b);
  n := n + 1; if cnt <> 0 then fails := fails || ' c:delete-others'; end if;
  n := n + 1; if not public.report_content('wall_post', p_members::text, 'spam', null) then fails := fails || ' c:report'; end if;
  n := n + 1; if public.report_content('wall_post', p_friends::text, 'spam', null) then fails := fails || ' c:report-hidden'; end if;
  n := n + 1; if public.report_content('wall_comment', cm1::text, 'spam', null) then fails := fails || ' c:report-own'; end if;
  ok := false;
  begin
    insert into public.wall_posts (wall_owner_id, author_id, body) values (a, c, 'direct');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:direct-insert'; end if;
  ok := false;
  begin
    update public.wall_posts set body = 'edited' where id = p_members;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:direct-update'; end if;
  execute 'reset role';

  -- ---- anon sees nothing of a Members wall ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  n := n + 1; if public.wall_access(a) <> 'none' then fails := fails || ' anon:access'; end if;
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 0 then fails := fails || ' anon:wall'; end if;
  select count(*) into cnt from public.wall_posts;
  n := n + 1; if cnt <> 0 then fails := fails || ' anon:rls'; end if;
  select count(*) into cnt from public.get_media_object(ph1);
  n := n + 1; if cnt <> 0 then fails := fails || ' anon:photo'; end if;
  execute 'reset role';

  -- ---- d, blocked by a, sees nothing ----
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.wall_access(a) <> 'none' then fails := fails || ' d:access'; end if;
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 0 then fails := fails || ' d:wall'; end if;
  select count(*) into cnt from public.get_media_object(ph1);
  n := n + 1; if cnt <> 0 then fails := fails || ' d:photo'; end if;
  n := n + 1; if public.create_wall_comment(p_members, 'x') is not null then fails := fails || ' d:comment'; end if;
  execute 'reset role';

  -- ---- b sees c's comment and reports; e's report is the third ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_wall_comments(p_members);
  n := n + 1; if cnt <> 1 then fails := fails || ' b:comments'; end if;
  n := n + 1; if not public.report_content('wall_comment', cm1::text, 'harassment', null) then fails := fails || ' b:report-comment'; end if;
  n := n + 1; if not public.report_content('wall_post', p_members::text, 'spam', null) then fails := fails || ' b:report'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', e::text, true);
  execute 'set local role authenticated';
  n := n + 1; if not public.report_content('wall_post', p_members::text, 'spam', null) then fails := fails || ' e:report'; end if;
  execute 'reset role';

  -- ---- what landed ----
  select status into v_txt from public.wall_posts where id = p_members;
  n := n + 1; if v_txt <> 'hidden' then fails := fails || ' hide-at-3:' || v_txt; end if;
  select count(*) into cnt from public.notifications where user_id = a and kind = 'wall_post';
  n := n + 1; if cnt <> 1 then fails := fails || ' notify-post:' || cnt; end if;
  select count(*) into cnt from public.notifications where user_id = a and kind = 'wall_comment';
  n := n + 1; if cnt <> 1 then fails := fails || ' notify-comment:' || cnt; end if;
  update public.profiles set profile_visibility = 'private' where id = b;

  -- ---- c: hidden post gone; b (now undiscoverable) shows no handle ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 2 then fails := fails || ' c:after-hide:' || cnt; end if;
  select w.author_username into v_txt from public.get_wall(a) w where w.id = p_b;
  n := n + 1; if v_txt is not null then fails := fails || ' c:private-handle'; end if;
  execute 'reset role';

  -- ---- a moderates their wall and changes settings ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  select w.author_username into v_txt from public.get_wall(a) w where w.id = p_b;
  n := n + 1; if v_txt is null then fails := fails || ' a:friend-handle'; end if;
  select count(*) into cnt from public.delete_wall_post(p_b);
  n := n + 1; if cnt <> 1 then fails := fails || ' a:delete-friend-post'; end if;
  n := n + 1; if not public.delete_wall_comment(cm1) then fails := fails || ' a:delete-comment'; end if;
  select x.photo_id, x.photo_owner into v_ph, v_po from public.delete_wall_post(p_photo) x;
  n := n + 1; if v_ph is distinct from ph1 or v_po is distinct from a then fails := fails || ' a:delete-photo-post'; end if;
  insert into public.profile_social (user_id, wall_audience, wall_posting) values (a, 'friends', 'only_me')
  on conflict (user_id) do update set wall_audience = excluded.wall_audience, wall_posting = excluded.wall_posting;
  execute 'reset role';
  select status into v_txt from public.member_photos where id = ph1;
  n := n + 1; if v_txt <> 'removed' then fails := fails || ' photo-removed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.wall_access(a) <> 'view' then fails := fails || ' b:only-me-posting'; end if;
  n := n + 1; if public.create_wall_post(a, 'x') is not null then fails := fails || ' b:post-refused'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.wall_access(a) <> 'none' then fails := fails || ' c:friends-wall'; end if;
  select count(*) into cnt from public.get_wall(a);
  n := n + 1; if cnt <> 0 then fails := fails || ' c:friends-wall-rows'; end if;
  execute 'reset role';

  -- ---- a Public wall on a Friends profile is still capped at Friends ----
  update public.profile_social set profile_audience = 'friends', wall_audience = 'public' where user_id = a;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  n := n + 1; if public.wall_access(a) <> 'none' then fails := fails || ' anon:profile-cap'; end if;
  execute 'reset role';

  if fails = '' then
    raise exception 'SOCIAL_WALL_OK checks=%', n;
  end if;
  raise exception 'SOCIAL_WALL_FAIL%', fails;
end;
$$;
