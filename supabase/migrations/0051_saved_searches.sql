-- ============================================================
-- 0051_saved_searches
--
-- User-defined alert rules. Each row is "watch for bills matching X
-- and notify me when new matches arrive." The daily cron sweeps these
-- after the bills sync + enrichment, finds new matches per saved
-- search, and fires in-app notifications + push.
--
-- Query shape (jsonb so we can grow without migrations):
--   {
--     "state": "OK",                    // optional, single state code
--     "relevance": "anti",              // optional: "pro" | "anti" | "neutral"
--     "keyword": "schedule",            // optional, ILIKE %keyword% on title+summary
--     "scope": "state"                  // optional: "state" | "federal"
--   }
--
-- last_match_check_at: timestamp of the last cron sweep that examined
-- this search. New matches are bills with last_synced_at > that
-- timestamp that match the query.
--
-- Cap at 10 saved searches per user to prevent abuse.
-- ============================================================

create table if not exists public.user_saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  query jsonb not null default '{}'::jsonb,
  alert_method text not null check (alert_method in ('push','email','both','in_app')) default 'in_app',
  active boolean not null default true,
  last_match_check_at timestamptz,
  total_matches int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_saved_searches_user
  on public.user_saved_searches (user_id, active)
  where active = true;

alter table public.user_saved_searches enable row level security;

drop policy if exists "saved_searches_self" on public.user_saved_searches;
create policy "saved_searches_self"
  on public.user_saved_searches
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Cap enforcement: trigger to reject inserts beyond 10 per user.
create or replace function public.enforce_saved_searches_cap()
returns trigger language plpgsql as $$
declare
  current_count int;
begin
  select count(*) into current_count
    from public.user_saved_searches
   where user_id = new.user_id;
  if current_count >= 10 then
    raise exception 'Saved searches limit reached (10 per user)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_saved_searches_cap on public.user_saved_searches;
create trigger trg_saved_searches_cap
  before insert on public.user_saved_searches
  for each row execute function public.enforce_saved_searches_cap();
