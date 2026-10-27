-- 0294_coalition_leaderboard.sql
--
-- Group badge + opt-in leaderboard (B4 g, owner ask 2026-10-27). The badge is
-- derived from coalition_wins().letters_total in code; it needs nothing here.
-- The leaderboard lists actions per member, @handle only, and ONLY for members
-- who turned it on: OFF by default. A member's advocacy count is theirs to
-- share; nobody else can switch it on for them.
--
--   coalition_members.leaderboard_opt_in_at  null = off (the default).
--   set_coalition_leaderboard(group, on)     your own row only.
--   coalition_leaderboard(group)             members (and site admins) only;
--     opted-in members' actions in the last 30 days and since they joined,
--     counted from campaign_actions the same way coalition_wins() counts them
--     (only what was sent after joining). Top 25. Returns user ids; the page
--     renders them through get_public_profiles + publicHandle().
--
-- No new table, so no new RLS: coalition_members has no UPDATE policy, and
-- the only writer of the new column is the SECURITY DEFINER RPC above.
--
-- Rollback: drop function public.coalition_leaderboard(uuid);
--           drop function public.set_coalition_leaderboard(uuid, boolean);
--           alter table public.coalition_members drop column leaderboard_opt_in_at;

alter table public.coalition_members
  add column if not exists leaderboard_opt_in_at timestamptz;

create or replace function public.set_coalition_leaderboard(p_coalition_id uuid, p_on boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  update public.coalition_members
     set leaderboard_opt_in_at = case when p_on then coalesce(leaderboard_opt_in_at, now()) else null end
   where coalition_id = p_coalition_id and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

revoke all on function public.set_coalition_leaderboard(uuid, boolean) from public, anon;
grant execute on function public.set_coalition_leaderboard(uuid, boolean) to authenticated, service_role;

create or replace function public.coalition_leaderboard(p_coalition_id uuid)
returns table (user_id uuid, actions_30d integer, actions_total integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.user_id,
         (count(ca.id) filter (where ca.sent_at > now() - interval '30 days'))::int,
         count(ca.id)::int
    from public.coalition_members m
    left join public.campaign_actions ca
      on ca.user_id = m.user_id and ca.sent_at >= m.joined_at
   where m.coalition_id = p_coalition_id
     and m.leaderboard_opt_in_at is not null
     and (public.is_coalition_member(p_coalition_id) or public.is_admin(auth.uid()))
   group by m.user_id
   order by 2 desc, 3 desc, m.user_id
   limit 25;
$$;

revoke all on function public.coalition_leaderboard(uuid) from public, anon;
grant execute on function public.coalition_leaderboard(uuid) to authenticated, service_role;
