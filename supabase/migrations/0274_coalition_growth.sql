-- 0274_coalition_growth.sql
--
-- Groups slice 1+2+3 (owner pick, 2026-10-21), to help the first group
-- ("Rein In Chaos") recruit and act together:
--   1. A reusable group link (`coalition_invites.reusable`). Her 6 links were
--      all single-use and none was ever used.
--   2. Public groups get a landing page with "Request to join"
--      (coalition_join_requests); the group's admins approve or decline.
--   3. "This week's group action": the group features one live campaign
--      (coalitions.featured_campaign_id), and members see aggregate progress
--      only (how many members acted, how many letters), never who.
--
-- Supabase stops granting new public tables by default on 2026-10-30, so the
-- grants below are explicit.
--
-- Rollback: drop function public.coalition_action_progress(uuid);
--           drop function public.decide_coalition_join_request(uuid, boolean);
--           drop table public.coalition_join_requests;
--           alter table public.coalitions drop column featured_campaign_id,
--             drop column featured_note, drop column featured_set_at;
--           alter table public.coalition_invites drop column reusable;

alter table public.coalition_invites
  add column if not exists reusable boolean not null default false;

alter table public.coalitions
  add column if not exists featured_campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists featured_note text check (featured_note is null or char_length(featured_note) <= 200),
  add column if not exists featured_set_at timestamptz;

create table if not exists public.coalition_join_requests (
  id            uuid primary key default gen_random_uuid(),
  coalition_id  uuid not null references public.coalitions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  message       text check (message is null or char_length(message) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null
);
create unique index if not exists ux_coalition_join_requests_pending
  on public.coalition_join_requests (coalition_id, user_id) where status = 'pending';

alter table public.coalition_join_requests enable row level security;

-- The requester sees their own; the group's owner/admins see their group's.
create policy "join_requests: own or group admin read" on public.coalition_join_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()));

-- Only for PUBLIC groups, only as yourself, only if not already a member.
create policy "join_requests: request a public group" on public.coalition_join_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (select 1 from public.coalitions c where c.id = coalition_id and c.is_public)
    and not public.is_coalition_member(coalition_id)
  );

-- Decisions go through decide_coalition_join_request(), which also adds the
-- member; no direct UPDATE policy, so the two can't drift apart.

grant select, insert on public.coalition_join_requests to authenticated;
grant all on public.coalition_join_requests to service_role;

-- Approve or decline. Group owner/admins (or a site admin) only.
create or replace function public.decide_coalition_join_request(p_request_id uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req public.coalition_join_requests%rowtype;
begin
  select * into v_req from public.coalition_join_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then return 'not_pending'; end if;
  if not (public.is_coalition_admin(v_req.coalition_id) or public.is_admin(auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.coalition_join_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_request_id;

  if p_approve then
    insert into public.coalition_members (coalition_id, user_id, role)
    values (v_req.coalition_id, v_req.user_id, 'member')
    on conflict do nothing;
  end if;
  return case when p_approve then 'approved' else 'declined' end;
end;
$$;

revoke execute on function public.decide_coalition_join_request(uuid, boolean) from public, anon;
grant execute on function public.decide_coalition_join_request(uuid, boolean) to authenticated;

-- Aggregate progress on the group's featured campaign. Members only; counts
-- only (how many members acted, how many letters), never who.
create or replace function public.coalition_action_progress(p_coalition_id uuid)
returns table (members_total integer, members_acted integer, letters_sent integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with c as (
    select featured_campaign_id, featured_set_at from public.coalitions
    where id = p_coalition_id
      and (public.is_coalition_member(p_coalition_id) or public.is_admin(auth.uid()))
  ),
  m as (select user_id from public.coalition_members where coalition_id = p_coalition_id)
  select
    (select count(*)::int from m),
    (select count(distinct a.user_id)::int from public.campaign_actions a, c
       where a.campaign_id = c.featured_campaign_id and a.user_id in (select user_id from m)
         and a.sent_at >= coalesce(c.featured_set_at, '-infinity'::timestamptz)),
    (select count(*)::int from public.campaign_actions a, c
       where a.campaign_id = c.featured_campaign_id and a.user_id in (select user_id from m)
         and a.sent_at >= coalesce(c.featured_set_at, '-infinity'::timestamptz))
  where exists (select 1 from c);
$$;

revoke execute on function public.coalition_action_progress(uuid) from public, anon;
grant execute on function public.coalition_action_progress(uuid) to authenticated;
