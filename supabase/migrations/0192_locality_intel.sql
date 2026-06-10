-- 0192_locality_intel.sql — per-locality intelligence record (PR-A).
--
-- One row per (state, locality): the locality's CURRENT legal framework,
-- any kratom measure being pushed (pending ordinances, hearings, effective
-- dates), and derived links into officials/meetings data. Produced by the
-- unified nightly sweep on the owner box (verify-local-bans.mjs writes it as
-- a byproduct of ban verification; sweep-locality-intel.mjs drains queued
-- rows, e.g. localities surfaced by news). Powers /banned's defensible
-- city+county counts, the dashboard war-room, and the Dossier.
--
-- Flat columns, CSV-exportable. The ban TRUTH stays in bills (two-source
-- gate, migration 0190) — this table is the intelligence layer around it.
--
-- Rollback: drop table public.locality_intel;

create table if not exists public.locality_intel (
  id uuid primary key default gen_random_uuid(),
  state text not null check (state ~ '^[A-Z]{2}$'),
  locality text not null,
  scope text not null default 'municipal' check (scope in ('municipal','county')),

  -- current legal framework (intel summary; bills rows remain the published truth)
  legal_status text check (legal_status in ('banned','repealed','pending_measure','no_local_law','uncertain')),
  legal_framework_md text,
  ordinance_citation text,
  ordinance_url text,

  -- measures being pushed right now
  pending_measures_md text,
  pending_count int not null default 0,

  -- derived cross-links (truth lives in legislators / municipal_meetings)
  officials_count int not null default 0,
  next_meeting_at timestamptz,

  -- provenance + sweep bookkeeping
  sources_md text,
  sweep_status text not null default 'queued' check (sweep_status in ('queued','swept','failed')),
  sweep_note text,
  swept_at timestamptz,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state, locality)
);

comment on table public.locality_intel is
  'Per-locality intelligence from the unified nightly sweep: legal framework, pending kratom measures, officials/meeting links. Ban truth stays in bills (0190 gate); this is the intel layer for /banned, dashboard, Dossier.';
comment on column public.locality_intel.legal_status is
  'banned=confirmed local ban in force · repealed=ban rescinded · pending_measure=kratom measure proposed/not yet effective · no_local_law=checked, nothing local found · uncertain=insufficient evidence';
comment on column public.locality_intel.sweep_status is
  'queued=awaiting the box''s nightly sweep · swept=intelligence captured · failed=sweep errored (retried next night)';

create index if not exists locality_intel_sweep_idx on public.locality_intel (sweep_status, state);
create index if not exists locality_intel_state_idx on public.locality_intel (state, scope);

alter table public.locality_intel enable row level security;

-- Public read (powers /banned + dashboard); writes are service-role only.
create policy "Public read locality intel"
  on public.locality_intel for select
  using (true);
