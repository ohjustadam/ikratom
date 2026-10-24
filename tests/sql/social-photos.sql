-- Member photo privacy suite (B4b slice b, migration 0286). Same contract as
-- social-privacy.sql: one DO block, run as postgres through the Management
-- API, ALWAYS raises at the end so everything rolls back.
--   SOCIAL_PHOTOS_OK checks=<n>  /  SOCIAL_PHOTOS_FAIL <labels>
--
-- Cast: a = owner (avatar: members; album: one friends, one public, one
--       only_me, one hidden by moderation)   b = a's friend
--       c = member     d = blocked by a     f = another member (3rd reporter)
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  f uuid := gen_random_uuid();
  p_avatar uuid := gen_random_uuid();
  p_friends uuid := gen_random_uuid();
  p_public uuid := gen_random_uuid();
  p_onlyme uuid := gen_random_uuid();
  p_hidden uuid := gen_random_uuid();
  p_c uuid := gen_random_uuid();
  r record;
  cnt int;
  ok boolean;
  txt text;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select x, 'social-photos-' || x || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, c, d, f]) x;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14), profile_visibility = 'public'
   where id in (a, b, c, d, f);
  insert into public.member_connections (requester_id, addressee_id, status, responded_at) values (a, b, 'accepted', now());
  insert into public.user_blocks (blocker_id, blocked_id) values (a, d);

  insert into public.member_photos (id, owner_id, kind, r2_key, content_type, bytes, width, height, audience, status)
  values
    (p_avatar,  a, 'avatar', 'photos/' || a || '/' || p_avatar  || '.jpg', 'image/jpeg', 100, 10, 10, 'members', 'active'),
    (p_friends, a, 'album',  'photos/' || a || '/' || p_friends || '.jpg', 'image/jpeg', 100, 10, 10, 'friends', 'active'),
    (p_public,  a, 'album',  'photos/' || a || '/' || p_public  || '.jpg', 'image/jpeg', 100, 10, 10, 'public',  'active'),
    (p_onlyme,  a, 'album',  'photos/' || a || '/' || p_onlyme  || '.jpg', 'image/jpeg', 100, 10, 10, 'only_me', 'active'),
    (p_hidden,  a, 'album',  'photos/' || a || '/' || p_hidden  || '.jpg', 'image/jpeg', 100, 10, 10, 'public',  'hidden'),
    (p_c,       c, 'album',  'photos/' || c || '/' || p_c       || '.jpg', 'image/jpeg', 100, 10, 10, 'public',  'active');
  insert into public.profile_social (user_id, profile_audience, avatar_photo_id) values (a, 'public', p_avatar);

  -- the storage key must be derived from the owner and the row id
  ok := false;
  begin
    insert into public.member_photos (owner_id, kind, r2_key, content_type, bytes, width, height)
      values (a, 'album', 'photos/' || c || '/' || p_c || '.jpg', 'image/jpeg', 1, 1, 1);
  exception when check_violation or unique_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' key-not-derived'; end if;

  -- ---- anon ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  select count(*) into cnt from public.get_media_object(p_public);
  n := n + 1; if cnt <> 1 then fails := fails || ' anon:public-media'; end if;
  select count(*) into cnt from public.get_media_object(p_friends);
  n := n + 1; if cnt <> 0 then fails := fails || ' anon:friends-media-leak'; end if;
  select count(*) into cnt from public.get_media_object(p_hidden);
  n := n + 1; if cnt <> 0 then fails := fails || ' anon:hidden-media-leak'; end if;
  select count(*) into cnt from public.get_profile_photos(a, 60);
  n := n + 1; if cnt <> 1 then fails := fails || ' anon:photo-list'; end if;
  select count(*) into cnt from public.member_photos where owner_id = a;
  n := n + 1; if cnt <> 1 then fails := fails || ' anon:rls-rows'; end if;
  ok := false;
  begin
    select r2_key into txt from public.member_photos limit 1;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:r2_key-readable'; end if;
  select avatar_url into txt from public.get_public_profile(a);
  n := n + 1; if txt is not null then fails := fails || ' anon:members-avatar-leak'; end if;
  execute 'reset role';

  -- ---- c: member ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_media_object(p_friends);
  n := n + 1; if cnt <> 0 then fails := fails || ' c:friends-media-leak'; end if;
  select count(*) into cnt from public.get_profile_photos(a, 60);
  n := n + 1; if cnt <> 2 then fails := fails || ' c:photo-list'; end if;
  select avatar_url into txt from public.get_public_profile(a);
  n := n + 1; if txt is distinct from '/api/media/' || p_avatar then fails := fails || ' c:avatar-members'; end if;
  select avatar_url into txt from public.get_profile_view(a);
  n := n + 1; if txt is distinct from '/api/media/' || p_avatar then fails := fails || ' c:view-avatar'; end if;
  update public.member_photos set caption = 'x' where id = p_public;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:foreign-caption'; end if;
  delete from public.member_photos where id = p_public;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:foreign-delete'; end if;
  ok := false;
  begin
    insert into public.member_photos (owner_id, kind, r2_key, content_type, bytes, width, height)
      values (c, 'album', 'photos/x.jpg', 'image/jpeg', 1, 1, 1);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:direct-insert'; end if;
  ok := false;
  begin
    insert into public.profile_social (user_id, avatar_photo_id) values (c, p_public);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:adopt-avatar'; end if;
  ok := false;
  begin
    update public.profiles set avatar_url = 'https://tracker.example/pixel.png' where id = c;
  exception when raise_exception then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:external-avatar-url'; end if;
  ok := false;
  begin
    update public.profiles set avatar_url = '/api/media/' || p_public where id = c;
  exception when raise_exception then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:foreign-avatar-url'; end if;
  update public.profiles set avatar_url = '/api/media/' || p_c where id = c;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 1 then fails := fails || ' c:own-avatar-url'; end if;
  n := n + 1; if public.report_member_photo(p_friends, 'spam', null) then fails := fails || ' c:report-unseen'; end if;
  n := n + 1; if not public.report_member_photo(p_public, 'spam', 'test') then fails := fails || ' c:report'; end if;
  n := n + 1; if public.report_member_photo(p_c, 'spam', null) then fails := fails || ' c:report-own'; end if;
  select count(*) into cnt from public.member_photo_reports;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:reads-reports'; end if;
  execute 'reset role';

  -- ---- b: friend ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_media_object(p_friends);
  n := n + 1; if cnt <> 1 then fails := fails || ' b:friends-media'; end if;
  select count(*) into cnt from public.get_media_object(p_onlyme);
  n := n + 1; if cnt <> 0 then fails := fails || ' b:onlyme-leak'; end if;
  select count(*) into cnt from public.get_profile_photos(a, 60);
  n := n + 1; if cnt <> 3 then fails := fails || ' b:photo-list'; end if;
  perform public.report_member_photo(p_public, 'harassment', null);
  execute 'reset role';

  -- ---- d: blocked ----
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_media_object(p_public);
  n := n + 1; if cnt <> 0 then fails := fails || ' d:public-media-when-blocked'; end if;
  select avatar_url into txt from public.get_public_profile(a);
  n := n + 1; if txt is not null then fails := fails || ' d:avatar-when-blocked'; end if;
  select count(*) into cnt from public.member_photos where owner_id = a;
  n := n + 1; if cnt <> 0 then fails := fails || ' d:rls-rows'; end if;
  execute 'reset role';

  -- ---- f: third reporter hides the photo ----
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f::text, true);
  execute 'set local role authenticated';
  perform public.report_member_photo(p_public, 'other', null);
  select count(*) into cnt from public.get_media_object(p_public);
  n := n + 1; if cnt <> 0 then fails := fails || ' f:auto-hide'; end if;
  execute 'reset role';
  select status, report_count into r from public.member_photos where id = p_public;
  n := n + 1; if r.status is distinct from 'hidden' or r.report_count <> 3 then fails := fails || ' auto-hide-state'; end if;

  -- ---- a: owner ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.get_media_object(p_onlyme);
  n := n + 1; if cnt <> 1 then fails := fails || ' a:onlyme-own'; end if;
  select count(*) into cnt from public.get_media_object(p_hidden);
  n := n + 1; if cnt <> 1 then fails := fails || ' a:hidden-own'; end if;
  select count(*) into cnt from public.get_profile_photos(a, 60);
  n := n + 1; if cnt <> 5 then fails := fails || ' a:photo-list'; end if;
  select count(*) into cnt from public.get_profile_photos(a, 60) where audience is null;
  n := n + 1; if cnt <> 0 then fails := fails || ' a:sees-own-audiences'; end if;
  update public.member_photos set caption = 'mine', audience = 'members' where id = p_friends;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 1 then fails := fails || ' a:own-update'; end if;
  ok := false;
  begin
    update public.member_photos set status = 'active' where id = p_hidden;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:self-unhide'; end if;
  execute 'reset role';

  if fails = '' then
    raise exception 'SOCIAL_PHOTOS_OK checks=%', n;
  end if;
  raise exception 'SOCIAL_PHOTOS_FAIL%', fails;
end;
$$;
