-- ============================================================
-- 0042_chat_mute_history_and_batch_profiles
--
-- Two things in one migration since they were both surfaced by the same
-- live-test pass on the lounge:
--
-- A) chat_mute_history — per-mute event log so we can compute cumulative
--    mute time per user and surface a "ban review" queue once a user
--    crosses 72 hours total. Existing `profiles.chat_muted_until` only
--    tracks the *current* state; this table tracks the trail.
--
--    Each `forever` mute is capped at 168h (1 week) for accumulation
--    purposes so a single forever mute doesn't immediately swamp the
--    counter into the millions of hours. (One 168h entry already trips
--    the 72h ban-review threshold by itself, which is the intended
--    behavior — forever muters get reviewed.)
--
-- B) get_public_profiles(p_ids uuid[]) — batch SECURITY DEFINER RPC
--    that returns public-safe profile fields for many users in one
--    round-trip. Same shape as the existing single-id `get_public_profile`,
--    just batched. Needed because the Lounge initial load resolves up to
--    30 author names at once, and the existing single-id RPC would mean
--    30 sequential round-trips.
--
--    Why an RPC and not a direct profiles SELECT: the profiles SELECT
--    RLS only allows admins to read others, so a regular user trying to
--    see "who said this in chat" was getting empty rows back. The
--    SECURITY DEFINER RPC bypasses RLS but exposes only fields safe for
--    the public surface (no email, no addr, no phone).
-- ============================================================

create table if not exists public.chat_mute_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted_by uuid references public.profiles(id) on delete set null,
  duration_hours numeric not null check (duration_hours > 0),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_mute_history_user
  on public.chat_mute_history (user_id, created_at desc);

alter table public.chat_mute_history enable row level security;

-- Only admins / owner can see + insert mute history. Mute UI in /admin/lounge
-- writes to this; nobody else has a reason to read it.
drop policy if exists "chat_mute_history_admin_select" on public.chat_mute_history;
create policy "chat_mute_history_admin_select"
  on public.chat_mute_history for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "chat_mute_history_admin_insert" on public.chat_mute_history;
create policy "chat_mute_history_admin_insert"
  on public.chat_mute_history for insert
  to authenticated
  with check (public.is_admin(auth.uid()) and muted_by = auth.uid());

-- ============================================================
-- B) Batch public-profile RPC
-- ============================================================
create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  full_name text,
  state text,
  city text,
  is_owner boolean,
  is_admin boolean,
  is_advocate_leader boolean,
  is_shop_owner boolean,
  shop_name text,
  is_medical_professional boolean,
  public_key text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select id, full_name, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at
    from public.profiles
   where id = any(p_ids);
$$;

grant execute on function public.get_public_profiles(uuid[]) to authenticated;

-- ============================================================
-- C) Helper view: cumulative mute hours per user (capped per-event).
-- Read from /admin/lounge to surface ban-review candidates.
-- ============================================================
create or replace view public.chat_mute_totals as
  select user_id,
         count(*) as mute_count,
         sum(least(duration_hours, 168)) as total_capped_hours
    from public.chat_mute_history
   group by user_id;

-- View security: SECURITY DEFINER on the underlying view via the function-
-- pattern. Easier path: a SECURITY DEFINER function that returns the
-- aggregate — keeps the surface narrow.
create or replace function public.chat_ban_review_queue()
returns table (
  user_id uuid,
  full_name text,
  mute_count int,
  total_capped_hours numeric,
  current_mute_until timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select t.user_id::uuid,
         p.full_name,
         t.mute_count::int,
         t.total_capped_hours,
         p.chat_muted_until
    from public.chat_mute_totals t
    join public.profiles p on p.id = t.user_id
   where t.total_capped_hours >= 72
   order by t.total_capped_hours desc, t.mute_count desc;
$$;

revoke all on function public.chat_ban_review_queue() from public;
grant execute on function public.chat_ban_review_queue() to authenticated;
