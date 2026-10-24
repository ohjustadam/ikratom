-- 0284_coalition_wins_welcome.sql
--
-- Group home, part 2 (owner picks B15b + B15c, 2026-10-24), for the first
-- community ("Rein In Chaos", MI):
--   b. A "wins" feed: what the group got done this week, as COUNTS only
--      (letters, officials reached, new members, events, posts). Never a name,
--      never who did what. coalition_wins() serves members, plus signed-in
--      visitors to a public group.
--   c. A welcome checklist for each new member: join → introduce yourself on
--      the board → take the group action → invite one person. Progress is
--      derived from what they actually did; the only new state is when they
--      shared the group link (coalition_members.shared_link_at) and when they
--      closed the checklist (welcome_done_at).
-- Plus the pieces of a familiar group home:
--   - a pinned post (coalition_threads.pinned_at), organizers only, enforced
--     by a trigger because the thread UPDATE policy also lets authors edit;
--   - a cover theme (coalitions.cover_theme), a preset banner rather than an
--     uploaded photo, so it costs no storage or egress and needs no moderation.
--
-- Rollback: drop function public.coalition_wins(uuid);
--           drop trigger coalition_threads_pin_guard on public.coalition_threads;
--           drop function public.coalition_threads_pin_guard();
--           alter table public.coalition_threads drop column pinned_at;
--           alter table public.coalition_members drop column shared_link_at, drop column welcome_done_at;
--           alter table public.coalitions drop column cover_theme;

alter table public.coalitions
  add column if not exists cover_theme text not null default 'emerald'
    check (cover_theme in ('emerald', 'sunrise', 'ocean', 'forest', 'violet', 'slate', 'leaf', 'flag'));

alter table public.coalition_members
  add column if not exists shared_link_at timestamptz,
  add column if not exists welcome_done_at timestamptz;

alter table public.coalition_threads
  add column if not exists pinned_at timestamptz;
create index if not exists ix_coalition_threads_pinned
  on public.coalition_threads (coalition_id, pinned_at desc) where pinned_at is not null and deleted_at is null;

-- Only a group organizer (or a site admin, or the service role) may pin,
-- whether on a new thread or an existing one.
create or replace function public.coalition_threads_pin_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if (case when tg_op = 'INSERT' then new.pinned_at is not null
           else new.pinned_at is distinct from old.pinned_at end)
     and auth.uid() is not null
     and not (public.is_coalition_admin(new.coalition_id) or public.is_admin(auth.uid())) then
    raise exception 'only the group''s organizers can pin posts' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists coalition_threads_pin_guard on public.coalition_threads;
create trigger coalition_threads_pin_guard
  before insert or update on public.coalition_threads
  for each row execute function public.coalition_threads_pin_guard();
revoke execute on function public.coalition_threads_pin_guard() from public, anon, authenticated;

-- The group's week, as counts. Letters count only what members sent after
-- they joined, so a newcomer's history doesn't inflate the group's. Members
-- see it; so does any signed-in visitor to a PUBLIC group, where the counts
-- are the recruiting pitch ("this group sent 40 letters").
create or replace function public.coalition_wins(p_coalition_id uuid)
returns table (
  letters_7d integer,
  letters_total integer,
  officials_7d integer,
  members_acted_7d integer,
  members_total integer,
  new_members_7d integer,
  events_7d integer,
  events_upcoming integer,
  posts_7d integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ok as (
    select 1 where public.is_coalition_member(p_coalition_id) or public.is_admin(auth.uid())
       or exists (select 1 from public.coalitions c where c.id = p_coalition_id and c.is_public)
  ),
  m as (
    select user_id, joined_at from public.coalition_members where coalition_id = p_coalition_id
  ),
  a as (
    select ca.user_id, ca.legislator_id, ca.sent_at
      from public.campaign_actions ca
      join m on m.user_id = ca.user_id and ca.sent_at >= m.joined_at
  )
  select
    (select count(*) from a where a.sent_at > now() - interval '7 days')::int,
    (select count(*) from a)::int,
    (select count(distinct a.legislator_id) from a where a.sent_at > now() - interval '7 days')::int,
    (select count(distinct a.user_id) from a where a.sent_at > now() - interval '7 days')::int,
    (select count(*) from m)::int,
    (select count(*) from m where m.joined_at > now() - interval '7 days')::int,
    (select count(*) from public.coalition_events e
      where e.coalition_id = p_coalition_id and e.cancelled_at is null
        and e.starts_at between now() - interval '7 days' and now())::int,
    (select count(*) from public.coalition_events e
      where e.coalition_id = p_coalition_id and e.cancelled_at is null and e.starts_at > now())::int,
    ((select count(*) from public.coalition_threads t
       where t.coalition_id = p_coalition_id and t.deleted_at is null and t.created_at > now() - interval '7 days')
     + (select count(*) from public.coalition_posts p
       where p.coalition_id = p_coalition_id and p.deleted_at is null and p.created_at > now() - interval '7 days'))::int
  where exists (select 1 from ok);
$$;

revoke execute on function public.coalition_wins(uuid) from public, anon;
grant execute on function public.coalition_wins(uuid) to authenticated, service_role;
