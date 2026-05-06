-- ============================================================
-- 0034 — Full-text search + action streaks + web-push subscriptions
-- ============================================================

-- ── Full-text search vectors ──────────────────────────────
-- Generated tsvector columns + GIN indexes on bills, forum_threads,
-- forum_posts. Used by /search page.

alter table public.bills
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english',
      coalesce(bill_number, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(summary_ai, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(advocacy_callout, '')
    )
  ) stored;
create index if not exists bills_search_idx on public.bills using gin (search_vector);

alter table public.forum_threads
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored;
create index if not exists forum_threads_search_idx on public.forum_threads using gin (search_vector);

alter table public.forum_posts
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;
create index if not exists forum_posts_search_idx on public.forum_posts using gin (search_vector);

-- ── Action streaks ────────────────────────────────────────
-- Days-in-a-row counter on profiles. Updated by trigger on every
-- campaign_action insert.
alter table public.profiles
  add column if not exists action_streak_days integer not null default 0,
  add column if not exists last_action_date date,
  add column if not exists longest_streak_days integer not null default 0;

create or replace function public.bump_action_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (new.sent_at at time zone 'utc')::date;
  v_last date;
  v_streak int;
  v_longest int;
begin
  select last_action_date, action_streak_days, longest_streak_days
    into v_last, v_streak, v_longest
    from public.profiles where id = new.user_id;
  if v_last is null then
    v_streak := 1;
  elsif v_today = v_last then
    -- already counted today; nothing to bump
    return new;
  elsif v_today = v_last + 1 then
    v_streak := v_streak + 1;
  else
    v_streak := 1;
  end if;
  if v_streak > coalesce(v_longest, 0) then v_longest := v_streak; end if;
  update public.profiles
    set action_streak_days = v_streak,
        last_action_date = v_today,
        longest_streak_days = v_longest
    where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists campaign_actions_streak_trigger on public.campaign_actions;
create trigger campaign_actions_streak_trigger
  after insert on public.campaign_actions
  for each row execute function public.bump_action_streak();

-- ── Web push subscriptions ────────────────────────────────
-- Standard PushSubscription shape: endpoint + p256dh + auth keys.
-- One row per (user_id, endpoint). User can revoke any time.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_self_all" on public.push_subscriptions;
create policy "push_self_all" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
