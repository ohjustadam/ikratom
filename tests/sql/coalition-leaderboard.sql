-- Opt-in leaderboard suite (migration 0294). One DO block as postgres that
-- ALWAYS raises, so it rolls back with zero residue.
--   COALITION_LEADERBOARD_OK checks=<n>  /  COALITION_LEADERBOARD_FAIL <labels>
--
-- Cast: a = the group's organizer   b = a member who opts in
--       c = a member who never opts in (busiest of all)   x = not in the group
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
  select u, 'lb-rls-' || u || '@example.invalid', 'authenticated', 'authenticated', now(), now()
    from unnest(array[a, b, c, x]) u;
  update public.profiles set username = 'zz' || substr(replace(id::text, '-', ''), 1, 14) where id in (a, b, c, x);
  insert into public.coalitions (slug, name, owner_id) values ('zz-lb-' || substr(replace(a::text, '-', ''), 1, 10), 'Leaderboard test', a) returning id into grp;
  insert into public.coalition_members (coalition_id, user_id, role, joined_at)
  values (grp, a, 'owner', now() - interval '60 days'), (grp, b, 'member', now() - interval '60 days'), (grp, c, 'member', now() - interval '60 days');
  -- trg_stamp_sent_at stamps every insert with now(), so backdate afterwards.
  -- b: 3 letters now, 1 at 40 days (total only), 1 before joining (never). c: 5, never opted in.
  insert into public.campaign_actions (user_id, method, source)
  select u, 'mailto', 'test' from unnest(array[b, b, b, b, b, c, c, c, c, c]) u;
  update public.campaign_actions set sent_at = now() - interval '40 days'
   where id = (select id from public.campaign_actions where user_id = b order by id limit 1);
  update public.campaign_actions set sent_at = now() - interval '90 days'
   where id = (select id from public.campaign_actions where user_id = b and sent_at = now() order by id limit 1);

  -- ---- b ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.coalition_leaderboard(grp);
  n := n + 1; if cnt <> 0 then fails := fails || ' off-by-default-' || cnt; end if;
  n := n + 1; if not public.set_coalition_leaderboard(grp, true) then fails := fails || ' b:cannot-opt-in'; end if;
  select count(*) into cnt from public.coalition_leaderboard(grp);
  n := n + 1; if cnt <> 1 then fails := fails || ' b:rows-' || cnt; end if;
  select * into r from public.coalition_leaderboard(grp) limit 1;
  n := n + 1; if r.user_id is distinct from b or r.actions_30d <> 3 or r.actions_total <> 4 then fails := fails || ' b:counts'; end if;
  -- b can't switch anyone else on, directly or through the RPC.
  ok := false;
  begin
    update public.coalition_members set leaderboard_opt_in_at = now() where coalition_id = grp and user_id = c;
    get diagnostics cnt = row_count;
    ok := cnt = 0;
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' b:opted-in-c'; end if;
  execute 'reset role';
  select count(*) into cnt from public.coalition_members where coalition_id = grp and leaderboard_opt_in_at is not null;
  n := n + 1; if cnt <> 1 then fails := fails || ' opted-in-rows-' || cnt; end if;

  -- ---- x, not in the group ----
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', x::text, true);
  execute 'set local role authenticated';
  n := n + 1; if public.set_coalition_leaderboard(grp, true) then fails := fails || ' x:opted-in'; end if;
  select count(*) into cnt from public.coalition_leaderboard(grp);
  n := n + 1; if cnt <> 0 then fails := fails || ' x:reads-' || cnt; end if;
  execute 'reset role';

  -- ---- anon ----
  execute 'set local role anon';
  ok := false;
  begin
    select count(*) into cnt from public.coalition_leaderboard(grp);
  exception when insufficient_privilege then ok := true;
  end;
  n := n + 1; if not ok then fails := fails || ' anon:reads'; end if;
  execute 'reset role';

  -- ---- b opts back out ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  perform public.set_coalition_leaderboard(grp, false);
  select count(*) into cnt from public.coalition_leaderboard(grp);
  n := n + 1; if cnt <> 0 then fails := fails || ' b:opt-out-' || cnt; end if;
  execute 'reset role';

  if fails = '' then
    raise exception 'COALITION_LEADERBOARD_OK checks=%', n;
  end if;
  raise exception 'COALITION_LEADERBOARD_FAIL%', fails;
end;
$$;
