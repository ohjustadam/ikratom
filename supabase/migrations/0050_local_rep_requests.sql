-- ============================================================
-- 0050_local_rep_requests
--
-- User-driven queue: when a user lands on the dashboard and we don't
-- have local reps for their city/county yet, they can click "Request
-- coverage" and an admin sees their area in a queue at
-- /admin/local-rep-requests. Admin runs the AI-suggest flow, picks
-- which suggestions to accept, and the existing acceptSuggestions
-- notification fan-out tells the requesting user(s) their reps
-- are now visible.
--
-- Schema notes:
--   - One row per (user, locality) pair — UNIQUE so re-clicking is
--     idempotent
--   - status: pending → fulfilled (when reps land) | rejected
--   - locality is the city or county string we'd match against
--     legislators.locality (already normalized via normalizeLocality)
--   - level: 'municipal' | 'county' so admin knows which type the user
--     wants suggestions for
-- ============================================================

create table if not exists public.local_rep_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'),
  locality text not null check (length(locality) between 1 and 120),
  level text not null check (level in ('municipal','county')),
  status text not null check (status in ('pending','fulfilled','rejected')) default 'pending',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (user_id, state, locality, level)
);

create index if not exists idx_local_rep_requests_pending
  on public.local_rep_requests (state, locality)
  where status = 'pending';

alter table public.local_rep_requests enable row level security;

-- Users can read + insert their own pending requests
drop policy if exists "rep_requests_self_read" on public.local_rep_requests;
create policy "rep_requests_self_read"
  on public.local_rep_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "rep_requests_self_insert" on public.local_rep_requests;
create policy "rep_requests_self_insert"
  on public.local_rep_requests for insert to authenticated
  with check (user_id = auth.uid());

-- Admin-only update (resolve / reject)
drop policy if exists "rep_requests_admin_update" on public.local_rep_requests;
create policy "rep_requests_admin_update"
  on public.local_rep_requests for update to authenticated
  using (public.is_admin(auth.uid()));

-- Auto-fulfill helper: called from acceptSuggestions to mark all
-- pending requests for a given (state, locality) as fulfilled in one
-- shot. Returns the count for the admin UI.
create or replace function public.fulfill_local_rep_requests(p_state text, p_locality text)
returns int
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.local_rep_requests
       set status = 'fulfilled',
           resolved_at = now()
     where state = p_state
       and locality = p_locality
       and status = 'pending'
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.fulfill_local_rep_requests(text, text) from public;
grant execute on function public.fulfill_local_rep_requests(text, text) to authenticated;
