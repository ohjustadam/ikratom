-- ============================================================
-- 0028 — Bills: session awareness + scope + official source URL
-- ============================================================
-- Three additions, all to fix the "zombie bill" problem:
--
-- 1) session_id text — the legislative session the bill belongs to
--    (e.g. "2024", "2025-2026", "117"). OpenStates returns this on
--    every bill. Without it, a bill whose session has ended looks
--    indistinguishable from a current-session bill — which is how
--    the OK SB 1639 (2024 kratom) zombie campaign got auto-created.
--
-- 2) official_url text — direct link to the state legislature's own
--    page for the bill. OpenStates sources us this at sync time.
--    Letting users verify the bill themselves on the official site is
--    a credibility multiplier.
--
-- 3) scope text — 'federal' / 'state' / 'county' / 'municipal'.
--    OpenStates only covers state + federal. County and municipal
--    bills must be admin-entered manually since no free comprehensive
--    API exists. This column lets us track them differently and keep
--    the UI honest about what it knows.
--
-- 4) locality text — for county/municipal scope, the place name
--    (e.g. "Tulsa, OK"). Mirrors the locality field on legislators.
-- ============================================================

alter table public.bills
  add column if not exists session_id text,
  add column if not exists official_url text,
  add column if not exists scope text not null default 'state',
  add column if not exists locality text;

-- Constrain scope to a known set
alter table public.bills
  drop constraint if exists bills_scope_check;
alter table public.bills
  add constraint bills_scope_check
  check (scope in ('federal','state','county','municipal'));

-- A locality is required for county/municipal scope, forbidden otherwise
alter table public.bills
  drop constraint if exists bills_locality_scope_check;
alter table public.bills
  add constraint bills_locality_scope_check
  check (
    (scope in ('federal','state') and locality is null) or
    (scope in ('county','municipal') and locality is not null)
  );

create index if not exists bills_session_idx
  on public.bills (state, session_id) where session_id is not null;
create index if not exists bills_scope_idx
  on public.bills (scope, active);
create index if not exists bills_locality_idx
  on public.bills (locality) where locality is not null;
