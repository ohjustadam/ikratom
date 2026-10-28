-- 0299_legiscan_change_hash.sql
--
-- Keep LegiScan usage under its REAL cap: 10,000 queries a month (the API's
-- own error, Oct 2026: "10,001 of 10,000"; the code had assumed 30,000).
-- October ran out on ~Oct 28 because the bill sync fetched every tracked bill
-- in full on every run, changed or not.
--
--   * bills.legiscan_change_hash — LegiScan's change_hash for the bill as we
--     last synced it. scripts/sync-bills-via-legiscan.mjs reads one master
--     list per state (one query) and only calls getBill when the hash moved.
--   * bills.legiscan_searched_at — when a bill with no LegiScan id was last
--     searched for. A failed search used to repeat on every run, forever; now
--     it retries weekly.
--
-- Flat columns, service-role writers only (the sync scripts); no new table,
-- so no grants are needed.
--
-- Rollback:
--   alter table public.bills drop column if exists legiscan_searched_at;
--   alter table public.bills drop column if exists legiscan_change_hash;

alter table public.bills
  add column if not exists legiscan_change_hash text,
  add column if not exists legiscan_searched_at timestamptz;

comment on column public.bills.legiscan_change_hash is
  'LegiScan change_hash as of our last getBill; getBill is skipped while the master list hash matches (0299).';
comment on column public.bills.legiscan_searched_at is
  'Last LegiScan search for a bill with no legiscan_bill_id; failed searches retry weekly (0299).';
