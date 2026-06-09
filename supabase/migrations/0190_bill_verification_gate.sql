-- 0190: provenance / two-source verification gate for bills.
--
-- WHY: 36 Mississippi local kratom bans (11 counties + 25 cities) were
-- bulk-seeded from a SINGLE aggregator (kratomlords.com) as
-- status='enacted', active=true, with no dates and a "verify later" note.
-- A local resident reported Monroe County still showing as banned — but the
-- Northeast Mississippi Daily Journal (djournal.com) reported the Monroe
-- County Board of Supervisors RESCINDED the ban on a 3-2 vote June 1, 2020.
-- Aggregators copy each other and miss repeals, so single-aggregator data
-- cannot be trusted as "currently true".
--
-- This adds a confirmation gate: a local-ban datum is only shown as a CURRENT
-- ban once corroborated by >= 2 sources with >= 1 authoritative (primary as
-- possible: county/city minutes, municipal code, local newspaper, AKA).
-- scripts/verify-local-bans.mjs promotes/holds rows; display surfaces already
-- gate on `active`, so held rows (active=false) simply stop showing.
--
-- ROLLBACK: alter table public.bills drop column verification_status,
--   drop column verified_at, drop column verification_note,
--   drop column verification_sources;

alter table public.bills
  add column if not exists verification_status text
    check (verification_status in ('unverified', 'single_source', 'confirmed', 'repealed')),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text,
  add column if not exists verification_sources jsonb;

comment on column public.bills.verification_status is
  'NULL = legacy synced real data (LegiScan/OpenStates feeds, inherently sourced). '
  'unverified / single_source = held, NOT shown as a current fact until corroborated. '
  'confirmed = >=2 sources incl. >=1 authoritative (verify-local-bans.mjs). '
  'repealed = was banned, since rescinded (kept for history, not shown as active).';

comment on column public.bills.verification_sources is
  'jsonb array of {url, tier:authoritative|semi|aggregator, checked_at} backing verification_status.';

-- Fast lookup for the verification cron + admin review.
create index if not exists idx_bills_verification_status
  on public.bills(verification_status)
  where verification_status is not null;
