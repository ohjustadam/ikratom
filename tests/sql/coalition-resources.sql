-- Pinned resources suite (migration 0293). One DO block as postgres that
-- ALWAYS raises, so it rolls back with zero residue.
--   COALITION_RESOURCES_OK checks=<n>  /  COALITION_RESOURCES_FAIL <labels>
--
-- Cast: a = the group's organizer   b = a member   x = not in the group
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  grp uuid;
  grp2 uuid;
  res_link uuid;
  res_tpl uuid;
  cnt int;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select u, 'res-rls-' || u || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, x]) u;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14) where id in (a, b, x);
  insert into public.coalitions (slug, name, owner_id) values ('zz-res-' || substr(replace(a::text, '-', ''), 1, 10), 'Resources test', a) returning id into grp;
  insert into public.coalitions (slug, name, owner_id) values ('zz-res2-' || substr(replace(a::text, '-', ''), 1, 10), 'Other group', a) returning id into grp2;
  insert into public.coalition_members (coalition_id, user_id, role) values (grp, a, 'owner'), (grp, b, 'member'), (grp2, a, 'owner');

  n := n + 1; if has_table_privilege('anon', 'public.coalition_resources', 'SELECT') then fails := fails || ' anon-select-granted'; end if;

  -- ---- a, the organizer ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  insert into public.coalition_resources (coalition_id, created_by, kind, title, url) values (grp, a, 'link', 'Hearing page', 'https://example.org/hearing') returning id into res_link;
  insert into public.coalition_resources (coalition_id, created_by, kind, title, subject, body) values (grp, a, 'template', 'Testimony', 'Subject', 'Dear {{official_greeting}}, ___') returning id into res_tpl;
  ok := false;
  begin
    insert into public.coalition_resources (coalition_id, created_by, kind, title, url) values (grp, a, 'link', 'Bad link', 'javascript:alert(1)');
  exception when check_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:javascript-url'; end if;
  ok := false;
  begin
    insert into public.coalition_resources (coalition_id, created_by, kind, title, url) values (grp, b, 'link', 'Forged', 'https://example.org');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:forged-pinner'; end if;
  -- An update can't re-home or re-attribute a resource.
  update public.coalition_resources set title = 'Hearing page (updated)', created_by = b, coalition_id = grp2 where id = res_link;
  execute 'reset role';
  select count(*) into cnt from public.coalition_resources where id = res_link and created_by = a and coalition_id = grp and title = 'Hearing page (updated)';
  n := n + 1; if cnt <> 1 then fails := fails || ' a:rehomed-or-reattributed'; end if;

  -- ---- b, a member ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.coalition_resources where coalition_id = grp;
  n := n + 1; if cnt <> 2 then fails := fails || ' b:reads-' || cnt; end if;
  ok := false;
  begin
    insert into public.coalition_resources (coalition_id, created_by, kind, title, url) values (grp, b, 'link', 'Member pin', 'https://example.org');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' b:pinned'; end if;
  update public.coalition_resources set title = 'Hijacked' where id = res_link;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' b:edited'; end if;
  delete from public.coalition_resources where id = res_tpl;
  get diagnostics cnt = row_count;
  n := n + 1; if cnt <> 0 then fails := fails || ' b:removed'; end if;
  n := n + 1; if not public.report_content('group_resource', res_link::text, 'spam', null) then fails := fails || ' b:cannot-report'; end if;
  execute 'reset role';

  -- ---- x, not in the group ----
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', x::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.coalition_resources where coalition_id = grp;
  n := n + 1; if cnt <> 0 then fails := fails || ' x:reads-' || cnt; end if;
  n := n + 1; if public.report_content('group_resource', res_link::text, 'spam', null) then fails := fails || ' x:reported'; end if;
  execute 'reset role';

  -- ---- anon ----
  execute 'set local role anon';
  ok := false;
  begin
    select count(*) into cnt from public.coalition_resources;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:reads'; end if;
  execute 'reset role';

  -- ---- the 30 cap ----
  insert into public.coalition_resources (coalition_id, created_by, kind, title, url)
  select grp, a, 'link', 'Filler ' || g, 'https://example.org/' || g from generate_series(1, 28) g;
  ok := false;
  begin
    insert into public.coalition_resources (coalition_id, created_by, kind, title, url) values (grp, a, 'link', 'One too many', 'https://example.org/31');
  exception when check_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' cap-30'; end if;

  -- ---- what landed ----
  select count(*) into cnt from public.content_reports where target_type = 'group_resource' and target_owner_id = a;
  n := n + 1; if cnt <> 1 then fails := fails || ' report-rows-' || cnt; end if;

  if fails = '' then
    raise exception 'COALITION_RESOURCES_OK checks=%', n;
  end if;
  raise exception 'COALITION_RESOURCES_FAIL%', fails;
end;
$$;
