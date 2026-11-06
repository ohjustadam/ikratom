-- 0313_coalition_listing_review.sql
-- New public groups wait for a moderator before they're listed (owner yes,
-- 2026-11-05; the second half of gap G2 from the r/kratom work).
--
-- is_public keeps its meaning (listed, and readable by everyone), so every page
-- and policy that filters on it stays right with no change. Asking to go public
-- now records listing_requested_at and leaves the group private; a moderator's
-- approval stamps listing_approved_at and turns is_public on. The group and its
-- invite link work the whole time. Approved once stays approved, so an organizer
-- can go private and back without another review.
--
-- A trigger does the holding, not the app, because the coalitions policies let
-- an owner write through the API directly (as 0309 notes). Only the service role
-- can approve; current_user is how 0276 tells them apart.
--
-- Rollback:
--   drop trigger if exists coalition_listing_guard on public.coalitions;
--   drop function if exists public.coalition_listing_guard();
--   drop index if exists public.coalitions_listing_waiting_idx;
--   alter table public.coalitions drop column if exists listing_requested_at,
--     drop column if exists listing_approved_at;

alter table public.coalitions
  add column if not exists listing_requested_at timestamptz,
  add column if not exists listing_approved_at timestamptz;

-- Both live public groups are already listed and passed the screens on
-- 2026-11-05, so they don't go back through the queue.
update public.coalitions set listing_approved_at = now() where is_public and listing_approved_at is null;

create index if not exists coalitions_listing_waiting_idx
  on public.coalitions (listing_requested_at)
  where listing_requested_at is not null and listing_approved_at is null;

create or replace function public.coalition_listing_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.listing_approved_at := case when tg_op = 'UPDATE' then old.listing_approved_at end;
  end if;
  if new.is_public and new.listing_approved_at is null then
    new.is_public := false;
    new.listing_requested_at := coalesce(new.listing_requested_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.coalition_listing_guard() from public, anon, authenticated;

drop trigger if exists coalition_listing_guard on public.coalitions;
create trigger coalition_listing_guard
  before insert or update of is_public, listing_approved_at on public.coalitions
  for each row execute function public.coalition_listing_guard();
