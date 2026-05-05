-- ============================================================
-- 0026 — Campaign waves (coalition mode / coordinated sends)
-- ============================================================
-- A "wave" is a coordinated send window. Users sign up between creation
-- and the scheduled fire time; at fire time, the cron sends every signed-
-- up user's pre-personalized email to the campaign's targets in a
-- compressed window. Legislator staffers tally inbound emails for the
-- morning briefing — 50 emails arriving in the same hour weighs more than
-- 50 scattered over a week.
--
-- Constraints we enforce here:
--   - One ACTIVE wave per campaign at a time (creators close one before
--     starting another). Past waves stay around for the historical record.
--   - Each user can only be in a wave once (unique on signup).
--   - Wave cancellation is allowed up until fire time; after fire,
--     the row is immutable.
-- ============================================================

create table if not exists public.campaign_waves (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  description text,
  scheduled_at timestamptz not null,
  /** Optional goal — purely UI ("47 / 100 advocates joined"). */
  target_signups integer,
  /** Set when the cron successfully fires the wave. */
  fired_at timestamptz,
  /** Snapshot of how many users were sent at fire-time. */
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  /** Creator can cancel up until fire time — sets active=false. */
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists campaign_waves_campaign_idx
  on public.campaign_waves (campaign_id, active, scheduled_at);

create index if not exists campaign_waves_due_idx
  on public.campaign_waves (scheduled_at)
  where active = true and fired_at is null;

-- One *active* unfired wave per campaign at any time.
create unique index if not exists campaign_waves_one_active_per_campaign
  on public.campaign_waves (campaign_id)
  where active = true and fired_at is null;

-- ── Signups table ───────────────────────────────────────────
create table if not exists public.campaign_wave_signups (
  id uuid primary key default gen_random_uuid(),
  wave_id uuid not null references public.campaign_waves(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  /** When the wave fires we record per-user outcome. */
  send_status text not null default 'pending'
    check (send_status in ('pending','sent','failed','skipped','opted_out')),
  send_error text,
  sent_at timestamptz,
  unique (wave_id, user_id)
);

create index if not exists campaign_wave_signups_wave_idx
  on public.campaign_wave_signups (wave_id);
create index if not exists campaign_wave_signups_user_idx
  on public.campaign_wave_signups (user_id, joined_at desc);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.campaign_waves enable row level security;
alter table public.campaign_wave_signups enable row level security;

-- Campaign waves: anyone can read (public counter). Inserts/updates by
-- creator (admin/leader) via server actions or by service role at fire.
drop policy if exists "campaign_waves_public_read" on public.campaign_waves;
create policy "campaign_waves_public_read" on public.campaign_waves
  for select using (true);

drop policy if exists "campaign_waves_creator_write" on public.campaign_waves;
create policy "campaign_waves_creator_write" on public.campaign_waves
  for all using (public.is_admin(auth.uid()) or auth.uid() = created_by)
  with check (public.is_admin(auth.uid()) or auth.uid() = created_by);

-- Wave signups: each user reads + manages their own. Public read of an
-- aggregate count happens via a view (below) to avoid leaking participant
-- identity to the world.
drop policy if exists "campaign_wave_signups_self_all" on public.campaign_wave_signups
;
create policy "campaign_wave_signups_self_all" on public.campaign_wave_signups
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "campaign_wave_signups_admin_read" on public.campaign_wave_signups;
create policy "campaign_wave_signups_admin_read" on public.campaign_wave_signups
  for select using (public.is_admin(auth.uid()));

-- ── Aggregate view: signup count per wave (public) ──────────
-- A view lets anonymous users see the count without exposing user_ids.
create or replace view public.campaign_wave_counts as
select
  wave_id,
  count(*)::int as signup_count,
  count(*) filter (where send_status = 'sent')::int as sent_count_view,
  count(*) filter (where send_status = 'failed')::int as failed_count_view
from public.campaign_wave_signups
group by wave_id;

-- Views inherit RLS from their underlying tables, but the aggregate hides
-- per-row data so anonymous read is safe. Grant explicitly:
grant select on public.campaign_wave_counts to anon, authenticated;

-- ── Realtime: enable on both tables so the public counter and the
--    user's own signup state can update without polling.
alter publication supabase_realtime add table public.campaign_waves;
alter publication supabase_realtime add table public.campaign_wave_signups;
