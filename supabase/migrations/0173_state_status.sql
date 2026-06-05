-- 0173_state_status.sql
-- State Mission Control PR2 — canonical per-state kratom + 7-OH status.
--
-- Stores an AUTO-DERIVED leaf/7-OH status per state (computed nightly by
-- scripts/derive-state-status.mjs from ENACTED, scope='state' bills + their
-- substance_targeting classification) PLUS admin override/confirm fields.
-- The prior read-only audit (scripts/audit-state-status-foundation.mjs)
-- proved naive derivation is unreliable for statute-only bans (IN/LA) and
-- KCPA edge cases — so the derivation flags those rows needs_review=true and
-- the admin_* columns let a human set the canonical answer (admin wins).
--
-- Derivation writes via service-role (no client INSERT policy). Admins
-- confirm/override (RLS). Public read so /states/[code] can show the header.
--
-- Rollback: drop table if exists public.state_status;

create table if not exists public.state_status (
  state text primary key references public.states(abbr) on delete cascade,

  -- Auto-derived (recomputed each run). Vocabulary matches the bill-signal
  -- derivation: 'banned' | 'restricted' | 'protected' | null (unknown).
  derived_leaf_status text
    check (derived_leaf_status is null or derived_leaf_status in ('banned', 'restricted', 'protected')),
  derived_7oh_status text
    check (derived_7oh_status is null or derived_7oh_status in ('banned', 'restricted', 'protected')),
  -- Which pool produced the signal: 'enacted' (current law) vs 'all-active'
  -- (no enacted bill — derived from PENDING bills, i.e. a threat not a law).
  basis text check (basis is null or basis in ('enacted', 'all-active')),
  enacted_count int not null default 0,
  leaf_evidence_bill text,      -- bill_number that produced the leaf signal (audit trail)
  sevenoh_evidence_bill text,

  -- Review flag — load-bearing. Naive derivation is wrong for: ban-state
  -- misses (statute-only IN/LA), pending-only signals (FL/TX/UT off
  -- non-enacted bills), and 7-OH inferred from synthetic-axis (KCPA) text.
  needs_review boolean not null default false,
  review_reason text,

  -- Admin override / confirm (PR4 queue writes these; PR5 header prefers
  -- them over derived_*). Broader vocabulary incl. legacy states.kratom_status.
  admin_leaf_status text
    check (admin_leaf_status is null or admin_leaf_status in ('legal', 'kcpa', 'banned', 'restricted', 'protected')),
  admin_7oh_status text
    check (admin_7oh_status is null or admin_7oh_status in ('legal', 'banned', 'restricted', 'protected')),
  admin_note text,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,

  derived_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_state_status_needs_review
  on public.state_status (needs_review, updated_at desc);

alter table public.state_status enable row level security;

-- Public read: the canonical status header on /states/[code] is public.
drop policy if exists "state_status: public read" on public.state_status;
create policy "state_status: public read"
  on public.state_status for select using (true);

-- Admin confirm/override. Inserts + derived recomputes happen via
-- service-role (the nightly script), which bypasses RLS.
drop policy if exists "state_status: admin update" on public.state_status;
create policy "state_status: admin update"
  on public.state_status for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
