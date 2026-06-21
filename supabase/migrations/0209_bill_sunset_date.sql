-- ============================================================
-- 0209_bill_sunset_date
--
-- Calendar-completeness: add bills.sunset_date — the date a law's kratom
-- provision automatically EXPIRES / is repealed (the mirror of effective_date,
-- mig 0029). Most kratom bills are permanent bans/scheduling with no sunset, so
-- coverage will be sparse — this is forward-looking infra: when a bill carries
-- an explicit sunset/expiration clause, scripts/extract-sunset-dates.mjs fills
-- it and /calendar + the .ics feed surface a "⏳ takes effect until / expires"
-- all-day event. Nullable, no backfill required.
--
-- Rollback: ALTER TABLE public.bills DROP COLUMN sunset_date;
-- ============================================================

alter table public.bills add column if not exists sunset_date date;

comment on column public.bills.sunset_date is
  'Date the bill''s kratom provision expires / is auto-repealed (sunset clause). Mirror of effective_date. Sparse — most bans are permanent. Filled by extract-sunset-dates.mjs.';
