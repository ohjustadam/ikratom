-- ============================================================
-- 0029 — Feature pack A
-- ============================================================
-- Bundles five small additions:
--   1. site_config        — single-row table for emergency-mode toggle
--   2. kratom_stories     — story bank (advocate testimony)
--   3. legislator_events  — town halls, hearings, public meetings
--   4. bills.effective_date / signed_at — surface "when does this hit"
--   (Story bank + events are admin-moderated before going public.)
-- ============================================================

-- ── 1. site_config ─────────────────────────────────────────
-- Single-row config table. Read by the root layout to render the
-- emergency banner + by various server components for feature flags.
create table if not exists public.site_config (
  id boolean primary key default true check (id),
  emergency_mode boolean not null default false,
  emergency_title text,
  emergency_body text,
  emergency_cta_label text,
  emergency_cta_href text,
  emergency_severity text default 'urgent' check (emergency_severity in ('info','urgent','critical')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Seed the singleton row
insert into public.site_config (id) values (true) on conflict (id) do nothing;

alter table public.site_config enable row level security;

drop policy if exists "site_config_public_read" on public.site_config;
create policy "site_config_public_read" on public.site_config for select using (true);

drop policy if exists "site_config_admin_write" on public.site_config;
create policy "site_config_admin_write" on public.site_config
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── 2. kratom_stories ──────────────────────────────────────
-- Advocate-submitted personal stories. Approved stories appear publicly
-- on /stories and can be referenced in campaign emails. Optional
-- anonymization respects the author's privacy.
create table if not exists public.kratom_stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  /** display_name shown publicly. If anonymous=true, we render "Anonymous". */
  anonymous boolean not null default false,
  display_name text,
  /** State/locality for matching to legislators. Null = federal/no-pref. */
  state text references public.states(abbr),
  /** Tags for filtering: 'pain' | 'recovery' | 'mental_health' | 'energy' | 'medical_pro' | 'shop_owner' | 'family' */
  tags text[] default '{}',
  /** Moderation pipeline: pending → approved → rejected (admin sets) */
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending','approved','rejected')),
  moderation_note text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  /** Author can withdraw their own story at any time → soft-delete. */
  deleted_at timestamptz,
  upvote_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists kratom_stories_status_idx
  on public.kratom_stories (moderation_status, created_at desc);
create index if not exists kratom_stories_state_idx
  on public.kratom_stories (state, moderation_status);
create index if not exists kratom_stories_author_idx
  on public.kratom_stories (author_id, created_at desc);

alter table public.kratom_stories enable row level security;

-- Approved + non-deleted stories: anyone can read
drop policy if exists "stories_public_read_approved" on public.kratom_stories;
create policy "stories_public_read_approved" on public.kratom_stories
  for select using (
    moderation_status = 'approved' and deleted_at is null
  );

-- Authors see their own (any status) so they can track moderation
drop policy if exists "stories_author_read_own" on public.kratom_stories;
create policy "stories_author_read_own" on public.kratom_stories
  for select using (auth.uid() = author_id);

drop policy if exists "stories_author_insert_own" on public.kratom_stories;
create policy "stories_author_insert_own" on public.kratom_stories
  for insert with check (auth.uid() = author_id);

-- Authors can withdraw + edit their own story while pending
drop policy if exists "stories_author_update_own" on public.kratom_stories;
create policy "stories_author_update_own" on public.kratom_stories
  for update using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Admins read all + moderate
drop policy if exists "stories_admin_all" on public.kratom_stories;
create policy "stories_admin_all" on public.kratom_stories
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── 3. legislator_events ───────────────────────────────────
-- Town halls, public hearings, listening sessions. No free nationwide
-- API; admin manual entry like /admin/locals. Public list at /events.
create table if not exists public.legislator_events (
  id uuid primary key default gen_random_uuid(),
  /** Which legislator is hosting (nullable — sometimes events are committee-wide) */
  legislator_id uuid references public.legislators(id) on delete set null,
  state text references public.states(abbr) not null,
  locality text,
  title text not null,
  description text,
  event_type text not null default 'town_hall'
    check (event_type in ('town_hall','public_hearing','listening_session','committee_hearing','floor_vote','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  /** "City Hall, 200 N State St, Tulsa OK 74103" — text not lat/lng (no map yet). */
  venue text,
  /** Official posting / announcement URL (legislator's site, news article). */
  source_url text,
  /** Active flag for soft-cancel. */
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists legislator_events_state_starts_idx
  on public.legislator_events (state, starts_at desc) where active = true;
create index if not exists legislator_events_legislator_idx
  on public.legislator_events (legislator_id, starts_at desc) where active = true;
create index if not exists legislator_events_upcoming_idx
  on public.legislator_events (starts_at) where active = true;

alter table public.legislator_events enable row level security;

drop policy if exists "events_public_read" on public.legislator_events;
create policy "events_public_read" on public.legislator_events for select using (active = true);

drop policy if exists "events_creator_admin_write" on public.legislator_events;
create policy "events_creator_admin_write" on public.legislator_events
  for all using (public.is_admin(auth.uid()) or auth.uid() = created_by)
  with check (public.is_admin(auth.uid()) or auth.uid() = created_by);

-- ── 4. bills: effective + signed dates ─────────────────────
-- "When does this take effect?" is the most-asked question about any
-- moving bill. OpenStates doesn't always populate these but admins can
-- set them manually for tracked bills.
alter table public.bills
  add column if not exists effective_date date,
  add column if not exists signed_at date;
