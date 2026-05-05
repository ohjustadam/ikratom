-- ============================================================
-- 0017 — Bills: unique constraint on (state, bill_number)
-- ============================================================
-- Needed for the OpenStates bills sync to upsert by natural key
-- (since these bills have no LegiScan ID).

create unique index if not exists bills_state_number_uniq
  on public.bills(state, bill_number);
