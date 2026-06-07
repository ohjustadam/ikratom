-- 0179_state_status_flips.sql
-- Scheduled, future-dated legal-status changes ("flips").
--
-- Some kratom-law changes are signed but FUTURE-DATED — e.g. Tennessee's
-- natural-leaf ban (HB1649, signed Apr 2026) takes effect 2026-07-01. We record
-- them here now; the daily cron scripts/queue-due-state-flips.mjs surfaces each
-- one into the /admin/state-status confirm queue (sets needs_review + a
-- review_reason describing the change) once its effective_date arrives, and
-- notifies the owner/admins. It does NOT auto-publish — the owner confirms the
-- new status via the existing confirm UI (matches the confirmed-only rule, so a
-- bad value can never reach the public map). This is the "self-auditing" guard
-- that stops the map silently showing the wrong status past a known flip date.
--
-- Rollback: drop table if exists public.state_status_flips;

create table if not exists public.state_status_flips (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.states(abbr) on delete cascade,
  -- which status this flip changes
  field text not null check (field in ('leaf', 'sevenoh')),
  -- the new value once it takes effect (admin vocabulary)
  new_status text not null
    check (new_status in ('legal', 'kcpa', 'banned', 'restricted', 'protected')),
  effective_date date not null,
  note text,
  source text,                  -- e.g. "TN HB1649" (audit trail)
  queued_at timestamptz,        -- set by the cron when it first surfaces + notifies
  created_at timestamptz not null default now(),
  unique (state, field, effective_date)
);

create index if not exists idx_state_status_flips_effective
  on public.state_status_flips (effective_date);

alter table public.state_status_flips enable row level security;

-- Admin read (a future UI may list upcoming flips). The cron writes via the
-- service-role client, which bypasses RLS.
drop policy if exists "state_status_flips: admin read" on public.state_status_flips;
create policy "state_status_flips: admin read"
  on public.state_status_flips for select
  using (public.is_admin(auth.uid()));

-- Seed the known scheduled flips (cross-referenced 2026-06-07). Idempotent.
insert into public.state_status_flips (state, field, new_status, effective_date, note, source)
values
  ('TN', 'leaf', 'banned', '2026-07-01',
   'Tennessee statewide ban on natural-leaf kratom (HB1649, signed Apr 16 2026) takes effect.', 'TN HB1649'),
  ('KY', 'leaf', 'banned', '2027-01-01',
   'Kentucky HB757 repeals the KCPA and bans kratom sales statewide (under a constitutional challenge filed Jun 2026).', 'KY HB757'),
  ('VA', 'sevenoh', 'banned', '2026-07-01',
   'Virginia HB360 bans 7-OH; the natural leaf stays legal under the KCPA.', 'VA HB360'),
  ('MN', 'leaf', 'restricted', '2026-08-01',
   'Minnesota age limit rises 18 to 21 (HF3453); leaf stays restricted — refresh the displayed note.', 'MN HF3453')
on conflict (state, field, effective_date) do nothing;
