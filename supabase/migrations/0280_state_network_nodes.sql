-- 0280_state_network_nodes.sql
--
-- The per-state "live network node" audit for /admin/intel-health/states
-- (branch B2: every state gets what Oklahoma got on 2026-10-21). A state is a
-- live node when all four hold:
--   * coverage:  >= 2 agency/BoP intel sources that scraped cleanly in the
--                last 3 days (bop_sources, intel step 1);
--   * targeting: >= 95% of its active state legislators have an email, so a
--                campaign can reach the whole legislature;
--   * people:    >= 3 advocates registered in the state;
--   * status:    its state_status was confirmed in the last 120 days.
-- One aggregated row per state, so the page reads 51 rows instead of
-- thousands of profiles and legislators (and never hits the 1,000-row cap).
-- Counts only: no names, emails or ids leave the function.
--
-- Admin-only: SECURITY DEFINER (profiles RLS allows only self/admin) behind
-- an is_admin() check; EXECUTE revoked from public/anon.
-- Rollback: drop function public.admin_state_network_nodes();

create or replace function public.admin_state_network_nodes()
returns table (
  state text,
  advocates integer,
  legislators integer,
  legislators_with_email integer,
  intel_sources integer,
  intel_sources_healthy integer,
  live_campaigns integer,
  status_leaf text,
  status_confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  return query
  with states as (
    select s.state from public.state_status s
  ),
  adv as (
    select upper(p.state) st, count(*)::int n
      from public.profiles p where p.state is not null group by 1
  ),
  leg as (
    select l.state st, count(*)::int n,
           count(*) filter (where coalesce(l.email, '') <> '')::int with_email
      from public.legislators l
     where l.active and l.role in ('state_house', 'state_senate')
     group by 1
  ),
  src as (
    select b.state st, count(*)::int n,
           count(*) filter (
             where b.last_status in ('ok', 'no_findings')
               and b.last_scraped_at > now() - interval '3 days'
           )::int healthy
      from public.bop_sources b where b.enabled group by 1
  ),
  camp as (
    select c.state st, count(*)::int n
      from public.campaigns c where c.active and c.state is not null group by 1
  )
  select st.state,
         coalesce(adv.n, 0),
         coalesce(leg.n, 0),
         coalesce(leg.with_email, 0),
         coalesce(src.n, 0),
         coalesce(src.healthy, 0),
         coalesce(camp.n, 0),
         coalesce(ss.admin_leaf_status, ss.derived_leaf_status),
         ss.confirmed_at
    from states st
    join public.state_status ss on ss.state = st.state
    left join adv on adv.st = st.state
    left join leg on leg.st = st.state
    left join src on src.st = st.state
    left join camp on camp.st = st.state
   order by st.state;
end;
$$;

revoke execute on function public.admin_state_network_nodes() from public, anon;
grant execute on function public.admin_state_network_nodes() to authenticated, service_role;
