-- 0283_coalition_events.sql
--
-- Group events and call-in days (owner pick B15a, 2026-10-24), for the first
-- community ("Rein In Chaos", MI). A group's organizers post an event (call-in
-- day, meeting, hearing watch, rally); members RSVP, add it to their calendar
-- (.ics or Google), and get a reminder the day before and again shortly
-- before it starts.
--
-- Privacy: events are visible to the group's members only. RSVPs are private
-- to the person who made them; everyone else sees counts only, through
-- coalition_event_counts(), never who is going.
--
-- Reminders: the hourly fire-waves cron inserts `notifications` rows (kind
-- 'coalition_event') for RSVP'd members and stamps reminder_*_sent_at with a
-- compare-and-set, so a re-run can't double-send. Push delivery goes through
-- the existing fanoutPushNotifications sweep (coalesced + rate-capped).
--
-- Supabase stops default grants on new public tables from 2026-10-30, so the
-- grants are explicit, and anon gets nothing.
--
-- Rollback: drop function public.coalition_event_counts(uuid);
--           drop table public.coalition_event_rsvps;
--           drop table public.coalition_events;

create table if not exists public.coalition_events (
  id                     uuid primary key default gen_random_uuid(),
  coalition_id           uuid not null references public.coalitions(id) on delete cascade,
  created_by             uuid references public.profiles(id) on delete set null,
  kind                   text not null default 'meeting'
                           check (kind in ('call_in', 'meeting', 'hearing', 'rally', 'other')),
  title                  text not null check (char_length(title) between 3 and 120),
  details                text check (details is null or char_length(details) <= 2000),
  starts_at              timestamptz not null,
  ends_at                timestamptz,
  -- The organizer's IANA zone, so "6:00 PM EST" reads the same for everyone.
  timezone               text not null default 'America/New_York'
                           check (char_length(timezone) between 3 and 64),
  location               text check (location is null or char_length(location) <= 300),
  link_url               text check (link_url is null or (char_length(link_url) <= 500 and link_url ~* '^https://')),
  -- Optional: the campaign members act on (a call-in day's script / letter).
  campaign_id            uuid references public.campaigns(id) on delete set null,
  reminder_day_sent_at   timestamptz,
  reminder_soon_sent_at  timestamptz,
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  constraint coalition_events_end_after_start check (ends_at is null or ends_at > starts_at)
);

create index if not exists ix_coalition_events_upcoming
  on public.coalition_events (coalition_id, starts_at) where cancelled_at is null;
create index if not exists ix_coalition_events_reminders
  on public.coalition_events (starts_at) where cancelled_at is null and reminder_soon_sent_at is null;

create table if not exists public.coalition_event_rsvps (
  event_id    uuid not null references public.coalition_events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null check (status in ('going', 'maybe', 'no')),
  updated_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists ix_coalition_event_rsvps_user on public.coalition_event_rsvps (user_id);

alter table public.coalition_events enable row level security;
alter table public.coalition_event_rsvps enable row level security;

-- Events: members read; the group's owner/admins post and edit (cancel).
create policy "coalition_events: members read" on public.coalition_events
  for select to authenticated
  using (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

create policy "coalition_events: organizers post" on public.coalition_events
  for insert to authenticated
  with check (created_by = auth.uid() and public.is_coalition_admin(coalition_id));

create policy "coalition_events: organizers edit" on public.coalition_events
  for update to authenticated
  using (public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()))
  with check (public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()));

-- RSVPs: your own row only, and only for a live event in a group you're in.
create policy "coalition_event_rsvps: own read" on public.coalition_event_rsvps
  for select to authenticated
  using (user_id = auth.uid());

create policy "coalition_event_rsvps: own insert" on public.coalition_event_rsvps
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.coalition_events e
      where e.id = event_id and e.cancelled_at is null and public.is_coalition_member(e.coalition_id)
    )
  );

create policy "coalition_event_rsvps: own update" on public.coalition_event_rsvps
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.coalition_events e
      where e.id = event_id and e.cancelled_at is null and public.is_coalition_member(e.coalition_id)
    )
  );

create policy "coalition_event_rsvps: own delete" on public.coalition_event_rsvps
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.coalition_events from anon;
revoke all on public.coalition_event_rsvps from anon;
grant select, insert, update on public.coalition_events to authenticated;
grant select, insert, update, delete on public.coalition_event_rsvps to authenticated;
grant all on public.coalition_events to service_role;
grant all on public.coalition_event_rsvps to service_role;

-- Going / maybe counts for a group's events. Members only; counts, never who.
create or replace function public.coalition_event_counts(p_coalition_id uuid)
returns table (event_id uuid, going integer, maybe integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.id,
         count(*) filter (where r.status = 'going')::int,
         count(*) filter (where r.status = 'maybe')::int
    from public.coalition_events e
    left join public.coalition_event_rsvps r on r.event_id = e.id
   where e.coalition_id = p_coalition_id
     and (public.is_coalition_member(p_coalition_id) or public.is_admin(auth.uid()))
   group by e.id;
$$;

revoke execute on function public.coalition_event_counts(uuid) from public, anon;
grant execute on function public.coalition_event_counts(uuid) to authenticated, service_role;
