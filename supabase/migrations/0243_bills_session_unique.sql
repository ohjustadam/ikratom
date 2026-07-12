-- ============================================================
-- 0243 — session-aware bill uniqueness
-- ============================================================
-- Every legislative session reuses bill numbers (there is an "SB 433" in
-- 2019-2020, 2021-2022, 2023-2024, 2025-2026 …). The old uniqueness key was
-- (state, bill_number) with NO session, so different sessions' bills collapsed
-- into one row and later syncs stapled a current-session bill's data onto a
-- dead old-session row — the Frankenstein-record bug (MI SB 433: a 2019-2020
-- kratom row wearing a 2025-2026 THC school bill's text). See PR #810 for the
-- sync-side guard (isSessionMismatch); this makes each session its own row so
-- the collision can't happen at the DB layer.
--
-- Safe ordering: create the NEW (broader) unique index FIRST, then drop the old
-- one — the table is never left without uniqueness. The new key is a strict
-- superset of the old, and the old (state,bill_number) uniqueness guarantees no
-- two existing rows can collide under (state,bill_number,session_id), so the
-- CREATE cannot fail on existing data. NULLS NOT DISTINCT (PG15+) keeps rows
-- with a null session_id from duplicating.
--
-- Rollback:
--   drop index if exists public.bills_state_billnum_session_uniq;
--   create unique index bills_state_number_uniq on public.bills (state, bill_number);

create unique index if not exists bills_state_billnum_session_uniq
  on public.bills (state, bill_number, session_id) nulls not distinct;

drop index if exists public.bills_state_number_uniq;
