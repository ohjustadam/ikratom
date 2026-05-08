-- ============================================================
-- 0060_forum_engagement
--
-- Forum engagement signals — visit tracking + per-forum subscriptions
-- + RPC for aggregate counts on the /forum index. The goal is to make
-- /forum feel like a real community: thread/post counts, "X new since
-- you visited," subscribe/mute per forum.
--
-- Two new tables, one RPC. Counts stay live-queried (no denormalized
-- columns on states / forum_communities) — avoids trigger drift, and
-- the aggregates are one GROUP BY scan over forum_threads which is
-- already indexed on (state) and (community_id).
--
-- forum_key encoding:
--   "state:OK"           — Oklahoma state forum
--   "state:FED"          — National (federal) forum
--   "community:<uuid>"   — topical community (forum_communities.id)
--
-- The `:` separator and the "state:" / "community:" prefix lets a
-- single subscription/visit table cover both — caller code computes
-- the key at call time. Cleaner than two parallel tables.
-- ============================================================

-- ----------------------------------------
-- forum_visits — per-user per-forum read marker
-- ----------------------------------------
create table if not exists public.forum_visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  forum_key text not null,
  last_visited_at timestamptz not null default now(),
  primary key (user_id, forum_key),
  constraint forum_visits_key_format
    check (forum_key ~ '^(state:[A-Z]{2,4}|community:[0-9a-f-]{36})$')
);

create index if not exists ix_forum_visits_user
  on public.forum_visits (user_id, last_visited_at desc);

alter table public.forum_visits enable row level security;

drop policy if exists forum_visits_self on public.forum_visits;
create policy forum_visits_self
  on public.forum_visits
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------
-- forum_subscriptions — opt-in alert mode per forum
-- ----------------------------------------
create table if not exists public.forum_subscriptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  forum_key text not null,
  mode text not null,  -- 'alerts' | 'digest' | 'mute'
  created_at timestamptz not null default now(),
  primary key (user_id, forum_key),
  constraint forum_subscriptions_key_format
    check (forum_key ~ '^(state:[A-Z]{2,4}|community:[0-9a-f-]{36})$'),
  constraint forum_subscriptions_mode_chk
    check (mode in ('alerts', 'digest', 'mute'))
);

create index if not exists ix_forum_subscriptions_alert_targets
  on public.forum_subscriptions (forum_key, mode)
  where mode in ('alerts', 'digest');

alter table public.forum_subscriptions enable row level security;

drop policy if exists forum_subscriptions_self on public.forum_subscriptions;
create policy forum_subscriptions_self
  on public.forum_subscriptions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------
-- RPC: forum_stats_for_index
--
-- Returns aggregates for every state forum + every active community in
-- ONE round-trip, optionally enriched with the calling user's unread
-- counts and subscription mode. The /forum index needs all of this on
-- first paint, so a single query is much better than 51 + N round trips.
--
-- Returns rows with shape:
--   forum_key      ('state:OK' | 'community:<uuid>')
--   thread_count   bigint   total non-removed threads
--   post_count     bigint   total non-deleted posts under those threads
--   last_activity  timestamptz   most recent thread.last_activity_at
--   unread_count   bigint   threads with last_activity > user's last_visited_at
--                           (always 0 when called anonymously)
--   sub_mode       text     'alerts' | 'digest' | 'mute' | null
-- ----------------------------------------
drop function if exists public.forum_stats_for_index();
create or replace function public.forum_stats_for_index()
returns table (
  forum_key text,
  thread_count bigint,
  post_count bigint,
  last_activity timestamptz,
  unread_count bigint,
  sub_mode text
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select auth.uid() as uid
  ),
  -- Per-state thread aggregates (only rows with state set, and not removed).
  state_agg as (
    select
      'state:' || t.state as forum_key,
      count(*)::bigint as thread_count,
      coalesce(sum(t.post_count), 0)::bigint as post_count,
      max(t.last_activity_at) as last_activity
    from public.forum_threads t
    where t.state is not null
      and (t.moderation_status is null or t.moderation_status <> 'removed')
    group by t.state
  ),
  -- Per-community aggregates.
  community_agg as (
    select
      'community:' || t.community_id::text as forum_key,
      count(*)::bigint as thread_count,
      coalesce(sum(t.post_count), 0)::bigint as post_count,
      max(t.last_activity_at) as last_activity
    from public.forum_threads t
    where t.community_id is not null
      and (t.moderation_status is null or t.moderation_status <> 'removed')
    group by t.community_id
  ),
  combined as (
    select * from state_agg
    union all
    select * from community_agg
  ),
  -- Unread per forum for the calling user. Joins forum_visits to
  -- forum_threads on the prefixed key so we can count threads with
  -- activity newer than last_visited_at.
  unread as (
    select
      v.forum_key,
      count(*) filter (
        where (
          (v.forum_key like 'state:%' and t.state = substring(v.forum_key from 7) and t.community_id is null)
          or
          (v.forum_key like 'community:%' and t.community_id::text = substring(v.forum_key from 11))
        )
        and t.last_activity_at > v.last_visited_at
        and (t.moderation_status is null or t.moderation_status <> 'removed')
      )::bigint as unread_count
    from public.forum_visits v
    cross join caller c
    join public.forum_threads t on (
      (v.forum_key like 'state:%' and t.state = substring(v.forum_key from 7))
      or
      (v.forum_key like 'community:%' and t.community_id::text = substring(v.forum_key from 11))
    )
    where v.user_id = c.uid
    group by v.forum_key
  ),
  subs as (
    select s.forum_key, s.mode
    from public.forum_subscriptions s, caller c
    where s.user_id = c.uid
  )
  select
    cb.forum_key,
    cb.thread_count,
    cb.post_count,
    cb.last_activity,
    -- Null when the caller has never visited this forum (or is anon).
    -- The UI only shows a "new" badge when this is non-null and > 0,
    -- so first-time visitors aren't blasted with "all 500 are new."
    u.unread_count,
    sb.mode as sub_mode
  from combined cb
  left join unread u on u.forum_key = cb.forum_key
  left join subs sb on sb.forum_key = cb.forum_key
$$;

-- Allow authenticated AND anonymous (anon sees thread/post counts but
-- unread_count falls back to thread_count and sub_mode is null).
grant execute on function public.forum_stats_for_index() to authenticated, anon;
