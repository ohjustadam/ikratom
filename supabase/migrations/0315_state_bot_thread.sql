-- 0315_state_bot_thread.sql
--
-- One bot thread per state. 376 of 378 forum threads were the bot's, one per
-- bill, so a member's thread disappeared among them (reported 2026-11-04).
-- scripts/auto-post-bills-to-forum.mjs now keeps a single running thread per
-- state and posts each new bill or status change as a comment.
--
-- is_state_digest marks that thread. bills.forum_update_key remembers the status
-- and action date last announced, so a change posts once. The old per-bill
-- threads are kept: bill pages link to them, and they list again if a person
-- replies. forum_stats_for_index stops counting the silent ones, so a state card
-- no longer says "51 threads" about a forum with none from people.
--
-- Rollback:
--   drop trigger if exists trg_guard_state_digest_flag on public.forum_threads;
--   drop function if exists public.guard_state_digest_flag();
--   drop index if exists public.forum_threads_one_digest_per_state;
--   alter table public.forum_threads drop column if exists is_state_digest;
--   alter table public.bills drop column if exists forum_update_key;
--   then restore forum_stats_for_index from 0060.

alter table public.forum_threads
  add column if not exists is_state_digest boolean not null default false;

create unique index if not exists forum_threads_one_digest_per_state
  on public.forum_threads (state)
  where is_state_digest;

alter table public.bills
  add column if not exists forum_update_key text;

-- A member can't claim a state's bot thread. Same role check as migration 0276.
create or replace function public.guard_state_digest_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.is_state_digest := case when tg_op = 'UPDATE' then old.is_state_digest else false end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_state_digest_flag on public.forum_threads;
create trigger trg_guard_state_digest_flag
  before insert or update of is_state_digest on public.forum_threads
  for each row execute function public.guard_state_digest_flag();

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
      and (not coalesce(t.system_generated, false) or t.is_state_digest or t.post_count > 0)
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
        and (not coalesce(t.system_generated, false) or t.is_state_digest or t.post_count > 0)
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
