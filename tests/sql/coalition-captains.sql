-- District captains + coverage suite (migration 0295). One DO block as
-- postgres that ALWAYS raises, so it rolls back with zero residue.
--   COALITION_CAPTAINS_OK checks=<n>  /  COALITION_CAPTAINS_FAIL <labels>
--
-- Cast (group in MI): a = organizer, MI HD 12   b = member, MI HD 12
--                     c = member who lives in OH   x = MI resident, not in the group
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  grp uuid;
  cnt int;
  r record;
  ok boolean;
  n int := 0;
  fails text := '';
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  select u, 'cap-rls-' || u || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, c, x]) u;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14), state = 'MI', state_house_district = '12'
   where id in (a, b, x);
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14), state = 'OH', state_house_district = '12'
   where id = c;
  insert into public.coalitions (slug, name, owner_id, state) values ('zz-cap-' || substr(replace(a::text, '-', ''), 1, 10), 'Captains test', a, 'MI') returning id into grp;
  insert into public.coalition_members (coalition_id, user_id, role) values (grp, a, 'owner'), (grp, b, 'member'), (grp, c, 'member');

  n := n + 1; if pg_get_function_result('public.coalition_district_coverage(uuid, text)'::regprocedure) <> 'TABLE(district text, members integer, has_captain boolean)' then fails := fails || ' coverage-shape'; end if;
  n := n + 1; if has_table_privilege('anon', 'public.coalition_district_captains', 'SELECT') then fails := fails || ' anon-select-granted'; end if;

  -- ---- b, a member ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.coalition_district_coverage(grp, 'state_house');
  n := n + 1; if cnt < 100 then fails := fails || ' b:universe-' || cnt; end if;
  select * into r from public.coalition_district_coverage(grp, 'state_house') where district = '12';
  n := n + 1; if r.members is distinct from 2 or r.has_captain then fails := fails || ' b:hd12-' || coalesce(r.members, -1); end if;
  select count(*) into cnt from public.coalition_district_coverage(grp, 'governor');
  n := n + 1; if cnt <> 0 then fails := fails || ' b:bad-chamber'; end if;
  ok := false;
  begin
    insert into public.coalition_district_captains (coalition_id, chamber, district, user_id, assigned_by) values (grp, 'state_house', '12', b, b);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' b:assigned'; end if;
  execute 'reset role';

  -- ---- a, the organizer ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  insert into public.coalition_district_captains (coalition_id, chamber, district, user_id, assigned_by) values (grp, 'state_house', '12', b, a);
  select * into r from public.coalition_district_coverage(grp, 'state_house') where district = '12';
  n := n + 1; if not coalesce(r.has_captain, false) then fails := fails || ' a:no-star'; end if;
  ok := false;
  begin
    insert into public.coalition_district_captains (coalition_id, chamber, district, user_id, assigned_by) values (grp, 'state_house', '13', x, a);
  exception when foreign_key_violation then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:non-member-captain'; end if;
  ok := false;
  begin
    insert into public.coalition_district_captains (coalition_id, chamber, district, user_id, assigned_by) values (grp, 'state_house', '14', b, b);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' a:forged-assigner'; end if;
  execute 'reset role';

  -- ---- x, not in the group ----
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', x::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.coalition_district_coverage(grp, 'state_house');
  n := n + 1; if cnt <> 0 then fails := fails || ' x:coverage-' || cnt; end if;
  select count(*) into cnt from public.coalition_district_captains where coalition_id = grp;
  n := n + 1; if cnt <> 0 then fails := fails || ' x:captains-' || cnt; end if;
  execute 'reset role';

  -- ---- anon ----
  execute 'set local role anon';
  ok := false;
  begin
    select count(*) into cnt from public.coalition_district_coverage(grp, 'state_house');
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:coverage'; end if;
  execute 'reset role';

  -- ---- b leaves: the captaincy goes with them ----
  delete from public.coalition_members where coalition_id = grp and user_id = b;
  select count(*) into cnt from public.coalition_district_captains where coalition_id = grp;
  n := n + 1; if cnt <> 0 then fails := fails || ' leaver-still-captain'; end if;

  if fails = '' then
    raise exception 'COALITION_CAPTAINS_OK checks=%', n;
  end if;
  raise exception 'COALITION_CAPTAINS_FAIL%', fails;
end;
$$;
