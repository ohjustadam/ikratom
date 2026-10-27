-- Social privacy RLS suite (B4b). Run by tests/social-privacy-db.test.ts.
--
-- One DO block, run through the Supabase Management API as postgres. It makes
-- five throwaway members, switches role to anon / authenticated with forged JWT
-- claims, and checks what each viewer can read. It ALWAYS ends by raising, so
-- the whole transaction rolls back: zero residue in the database.
--   SOCIAL_PRIVACY_OK checks=<n>   every check passed
--   SOCIAL_PRIVACY_FAIL <labels>   the checks that failed
--
-- Cast: a = owner (profile public; bio public; story friends; links members;
--       interests only_me; friends list friends; activity members)
--       b = a's friend      c = a member who sent a a request
--       d = blocked by a    e = private, never discoverable, no settings row
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  e_name text;
  r record;
  found_row boolean;
  cnt int;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  -- ---- setup, as postgres ----
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select x, 'social-rls-' || x || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, c, d, e]) x;
  update public.profiles
     set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14),
         profile_visibility = 'public'
   where id in (a, b, c, d, e);
  update public.profiles set profile_visibility = 'private' where id = e;
  select username into e_name from public.profiles where id = e;

  insert into public.member_connections (requester_id, addressee_id, status, responded_at)
    values (a, b, 'accepted', now());
  insert into public.member_connections (requester_id, addressee_id, status)
    values (c, a, 'pending');
  insert into public.user_blocks (blocker_id, blocked_id) values (a, d);
  insert into public.profile_social (user_id, bio, story, interests, profile_audience, bio_audience,
      story_audience, links_audience, interests_audience, friends_audience, activity_audience)
    values (a, 'bio-a', 'story-a', array['veteran'], 'public', 'public',
      'friends', 'members', 'only_me', 'friends', 'members');
  insert into public.profile_links (user_id, position, label, url)
    values (a, 0, 'site', 'https://example.org');

  -- ---- anonymous visitor ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  select * into r from public.get_profile_view(a);
  found_row := found;
  n := n + 1; if not found_row then fails := fails || ' anon:a:row'; end if;
  n := n + 1; if not coalesce(r.profile_visible, false) then fails := fails || ' anon:a:visible'; end if;
  n := n + 1; if r.bio is distinct from 'bio-a' then fails := fails || ' anon:a:bio-public'; end if;
  n := n + 1; if r.story is not null then fails := fails || ' anon:a:story-friends-leak'; end if;
  n := n + 1; if r.links is not null then fails := fails || ' anon:a:links-members-leak'; end if;
  n := n + 1; if r.interests is not null then fails := fails || ' anon:a:interests-onlyme-leak'; end if;
  n := n + 1; if r.friend_count is not null then fails := fails || ' anon:a:friends-leak'; end if;
  n := n + 1; if coalesce(r.activity_visible, true) or r.action_count is not null then fails := fails || ' anon:a:activity-leak'; end if;
  n := n + 1; if coalesce(r.can_message, true) then fails := fails || ' anon:a:can-message'; end if;

  -- b has no settings row: default profile audience = members, so a stranger
  -- gets the discoverable card (handle) but no sections.
  select * into r from public.get_profile_view(b);
  n := n + 1; if not found or coalesce(r.profile_visible, true) or r.state is not null then fails := fails || ' anon:b:default-members'; end if;

  select * into r from public.get_profile_view(e);
  n := n + 1; if found then fails := fails || ' anon:e:private-row-leak'; end if;
  select * into r from public.get_profile_view_by_username(e_name);
  n := n + 1; if found then fails := fails || ' anon:e:username-enumeration'; end if;

  ok := false;
  begin
    select count(*) into cnt from public.profile_social;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:profile_social-readable'; end if;
  ok := false;
  begin
    select count(*) into cnt from public.member_connections;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:connections-readable'; end if;

  execute 'reset role';

  -- ---- c: a signed-in member, not a friend, with a pending request to a ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c::text, true);
  execute 'set local role authenticated';

  select * into r from public.get_profile_view(a);
  n := n + 1; if r.relationship is distinct from 'pending_out' then fails := fails || ' c:a:relationship'; end if;
  n := n + 1; if r.story is not null then fails := fails || ' c:a:story-friends-leak'; end if;
  n := n + 1; if r.links is null or jsonb_array_length(r.links) <> 1 then fails := fails || ' c:a:links-members'; end if;
  n := n + 1; if r.interests is not null then fails := fails || ' c:a:interests-onlyme-leak'; end if;
  n := n + 1; if r.friend_count is not null then fails := fails || ' c:a:friends-leak'; end if;
  n := n + 1; if not coalesce(r.activity_visible, false) then fails := fails || ' c:a:activity-members'; end if;

  select count(*) into cnt from public.profile_social where user_id = a;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:profile_social-direct-read'; end if;
  select count(*) into cnt from public.profile_links where user_id = a;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:profile_links-direct-read'; end if;
  select count(*) into cnt from public.member_connections;
  n := n + 1; if cnt <> 1 then fails := fails || ' c:connections-sees-others'; end if;
  n := n + 1; if public.can_view_audience(a, 'friends') then fails := fails || ' c:can-view-friends'; end if;

  ok := false;
  begin
    insert into public.member_connections (requester_id, addressee_id, status) values (c, b, 'accepted');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:connection-direct-insert'; end if;
  ok := false;
  begin
    insert into public.profile_social (user_id, bio) values (b, 'hijack');
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' c:profile_social-foreign-insert'; end if;
  update public.profile_social set bio = 'hijack' where user_id = a;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' c:profile_social-foreign-update'; end if;

  execute 'reset role';

  -- ---- b: a's friend ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select * into r from public.get_profile_view(a);
  n := n + 1; if r.relationship is distinct from 'friends' then fails := fails || ' b:a:relationship'; end if;
  n := n + 1; if r.story is distinct from 'story-a' then fails := fails || ' b:a:story-friends'; end if;
  n := n + 1; if r.friend_count is distinct from 1 then fails := fails || ' b:a:friend-count'; end if;
  n := n + 1; if r.interests is not null then fails := fails || ' b:a:interests-onlyme-leak'; end if;
  execute 'reset role';

  -- ---- d: blocked by a ----
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d::text, true);
  execute 'set local role authenticated';
  select * into r from public.get_profile_view(a);
  n := n + 1; if found then fails := fails || ' d:a:blocked-row-leak'; end if;
  n := n + 1; if public.can_view_audience(a, 'public') then fails := fails || ' d:a:can-view-public'; end if;
  execute 'reset role';

  -- ---- a: the owner ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  select * into r from public.get_profile_view(a);
  n := n + 1; if r.relationship is distinct from 'self' or r.interests is distinct from array['veteran'] then fails := fails || ' a:self-sees-all'; end if;
  select * into r from public.get_profile_view(d);
  n := n + 1; if r.relationship is distinct from 'blocked' or coalesce(r.profile_visible, true) then fails := fails || ' a:d:blocked-card'; end if;
  n := n + 1; if public.can_view_audience(d, 'public') then fails := fails || ' a:d:blocker-sees'; end if;
  select * into r from public.get_profile_view(e);
  n := n + 1; if found then fails := fails || ' a:e:private-row-leak'; end if;
  select * into r from public.get_my_profile_social();
  n := n + 1; if r.profile_audience is distinct from 'public' then fails := fails || ' a:my-settings'; end if;
  execute 'reset role';

  -- ---- e: private member, no settings row ----
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', e::text, true);
  execute 'set local role authenticated';
  select * into r from public.get_profile_view(e);
  n := n + 1; if not found or r.relationship is distinct from 'self' then fails := fails || ' e:self-row'; end if;
  select * into r from public.get_my_profile_social();
  n := n + 1; if r.profile_audience is distinct from 'only_me' then fails := fails || ' e:derived-only-me'; end if;
  execute 'reset role';

  if fails = '' then
    raise exception 'SOCIAL_PRIVACY_OK checks=%', n;
  end if;
  raise exception 'SOCIAL_PRIVACY_FAIL%', fails;
end;
$$;
