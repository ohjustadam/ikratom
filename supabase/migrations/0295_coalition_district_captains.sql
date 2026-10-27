-- 0295_coalition_district_captains.sql
--
-- District captains + a coverage map (B4 d, owner ask 2026-10-27). Organizers
-- name one member as captain for a district (state house, state senate or
-- U.S. House) so every office has someone who owns it. The coverage map shows,
-- per district, HOW MANY members live there and whether it has a captain:
-- counts only, never a name.
--
--   coalition_district_captains  one captain per (group, chamber, district).
--     The captain must be a member: the foreign key to coalition_members
--     drops the row when they leave. Members read (the captain list shows
--     @handle); only the group's organizers assign or remove.
--   coalition_district_coverage(group, chamber)  members (and site admins)
--     only. Every district of the group's state for that chamber (from the
--     active legislators), plus any district a member lives in, with the
--     member count and a has-captain flag. Profiles are private, so it is
--     SECURITY DEFINER and returns counts, never who.
--
-- Rollback: drop function public.coalition_district_coverage(uuid, text);
--           drop table public.coalition_district_captains;

create table if not exists public.coalition_district_captains (
  coalition_id  uuid not null,
  chamber       text not null check (chamber in ('state_house', 'state_senate', 'us_house')),
  district      text not null check (char_length(district) between 1 and 80),
  user_id       uuid not null,
  assigned_by   uuid references public.profiles(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  primary key (coalition_id, chamber, district),
  foreign key (coalition_id, user_id) references public.coalition_members(coalition_id, user_id) on delete cascade
);
create index if not exists ix_coalition_captains_member
  on public.coalition_district_captains (coalition_id, user_id);

alter table public.coalition_district_captains enable row level security;

drop policy if exists "coalition_captains: members read" on public.coalition_district_captains;
create policy "coalition_captains: members read" on public.coalition_district_captains
  for select to authenticated
  using (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

drop policy if exists "coalition_captains: organizers assign" on public.coalition_district_captains;
create policy "coalition_captains: organizers assign" on public.coalition_district_captains
  for insert to authenticated
  with check (assigned_by = auth.uid() and public.is_coalition_admin(coalition_id));

drop policy if exists "coalition_captains: organizers reassign" on public.coalition_district_captains;
create policy "coalition_captains: organizers reassign" on public.coalition_district_captains
  for update to authenticated
  using (public.is_coalition_admin(coalition_id))
  with check (assigned_by = auth.uid() and public.is_coalition_admin(coalition_id));

drop policy if exists "coalition_captains: organizers remove" on public.coalition_district_captains;
create policy "coalition_captains: organizers remove" on public.coalition_district_captains
  for delete to authenticated
  using (public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()));

revoke all on public.coalition_district_captains from anon, authenticated;
grant select, insert, update, delete on public.coalition_district_captains to authenticated;
grant all on public.coalition_district_captains to service_role;

create or replace function public.coalition_district_coverage(p_coalition_id uuid, p_chamber text)
returns table (district text, members integer, has_captain boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ok as (
    select 1 where (public.is_coalition_member(p_coalition_id) or public.is_admin(auth.uid()))
               and p_chamber in ('state_house', 'state_senate', 'us_house')
  ),
  g as (
    select c.state from public.coalitions c where c.id = p_coalition_id and c.state is not null
  ),
  universe as (
    select distinct l.district from public.legislators l join g on l.state = g.state
     where l.active and l.role = p_chamber and l.district is not null
  ),
  homes as (
    select case p_chamber
             when 'state_house' then p.state_house_district
             when 'state_senate' then p.state_senate_district
             else p.congressional_district end as district
      from public.coalition_members m
      join public.profiles p on p.id = m.user_id
      join g on p.state = g.state
     where m.coalition_id = p_coalition_id
  ),
  counts as (
    select h.district, count(*)::int as n from homes h where h.district is not null group by h.district
  ),
  d as (
    select u.district from universe u union select c.district from counts c
  )
  select d.district,
         coalesce(c.n, 0),
         exists (select 1 from public.coalition_district_captains k
                  where k.coalition_id = p_coalition_id and k.chamber = p_chamber and k.district = d.district)
    from d
    left join counts c on c.district = d.district
   where exists (select 1 from ok)
   order by nullif(regexp_replace(d.district, '[^0-9].*$', ''), '')::int nulls last, d.district;
$$;

revoke all on function public.coalition_district_coverage(uuid, text) from public, anon;
grant execute on function public.coalition_district_coverage(uuid, text) to authenticated, service_role;
