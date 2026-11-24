-- 0331_media_board_actions.sql
--
-- WHY (PJ, 2026-11-24; owner "take your picks"): a weekly "Top 5" board on
-- /media, so no kratom story goes unanswered. Members tick what they did for a
-- story: "emailed" the writer (recorded when they open a reply) and
-- "commented" on it (their own tick). The board shows the counts, and a
-- monthly leaderboard shows who did the most, by @username only.
--
-- Privacy:
--   - A member reads, adds and removes only their own ticks (RLS).
--   - Counts and the leaderboard come from two SECURITY DEFINER functions
--     that only the service role may call; the cached /media page calls them.
--     No client can list who ticked what.
--   - The leaderboard returns user ids to the server only; the page shows a
--     handle only for public profiles (get_public_profiles), else "An advocate".
--     No state is returned, so members in ban states are never placed.
--
-- New public tables get no default grants after 2026-10-30: every grant is explicit.
--
-- ROLLBACK:
--   drop function if exists public.media_board_leaderboard(timestamptz, int);
--   drop function if exists public.media_board_counts(uuid[]);
--   drop table if exists public.media_board_actions;

create table if not exists public.media_board_actions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  news_item_id uuid not null references public.news_items(id) on delete cascade,
  kind text not null check (kind in ('emailed', 'commented')),
  created_at timestamptz not null default now(),
  primary key (user_id, news_item_id, kind)
);

comment on table public.media_board_actions is
  'One row per member, story and action on the /media Top 5 board (emailed the writer, commented). Own rows only; counts via media_board_counts. Migration 0331.';

create index if not exists media_board_actions_story_idx on public.media_board_actions (news_item_id);
create index if not exists media_board_actions_created_idx on public.media_board_actions (created_at desc);

alter table public.media_board_actions enable row level security;

drop policy if exists media_board_actions_own_read on public.media_board_actions;
create policy media_board_actions_own_read on public.media_board_actions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists media_board_actions_own_insert on public.media_board_actions;
create policy media_board_actions_own_insert on public.media_board_actions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists media_board_actions_own_delete on public.media_board_actions;
create policy media_board_actions_own_delete on public.media_board_actions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.media_board_actions from public, anon;
grant select, insert, delete on public.media_board_actions to authenticated;
grant all on public.media_board_actions to service_role;

-- Counts per story, for the board.
create or replace function public.media_board_counts(p_ids uuid[])
returns table (news_item_id uuid, emailed int, commented int)
language sql
stable
security definer
set search_path = public
as $$
  select a.news_item_id,
         count(*) filter (where a.kind = 'emailed')::int,
         count(*) filter (where a.kind = 'commented')::int
    from public.media_board_actions a
   where a.news_item_id = any (p_ids[1:50])
   group by a.news_item_id;
$$;

-- Who did the most since p_since (the board passes the start of the month).
create or replace function public.media_board_leaderboard(p_since timestamptz, p_limit int default 10)
returns table (user_id uuid, actions int)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id, count(*)::int
    from public.media_board_actions a
   where a.created_at >= coalesce(p_since, now() - interval '31 days')
   group by a.user_id
   order by count(*) desc, min(a.created_at) asc
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

revoke execute on function public.media_board_counts(uuid[]) from public, anon, authenticated;
revoke execute on function public.media_board_leaderboard(timestamptz, int) from public, anon, authenticated;
grant execute on function public.media_board_counts(uuid[]) to service_role;
grant execute on function public.media_board_leaderboard(timestamptz, int) to service_role;
