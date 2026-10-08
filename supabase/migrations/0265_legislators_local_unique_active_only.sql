-- 0265_legislators_local_unique_active_only.sql — the local-official dedupe
-- index should only stop two ACTIVE rows for the same person.
--
-- Background (2026-10-07): the refresh batch created "Jasi Mikae Edwards" as
-- a duplicate of Trenton's existing "Jasi Edwards". Retiring the duplicate and
-- renaming the original to the official spelling failed:
--   duplicate key value violates unique constraint "ux_legislators_local_unique"
-- because the index (0055) also counts retired rows. A retired row is history,
-- not a live competitor, so it shouldn't block correcting the live one. Nothing
-- upserts on this index (no onConflict against legislators), so narrowing the
-- predicate changes no write path.
--
-- Rollback:
--   drop index if exists public.ux_legislators_local_unique;
--   create unique index ux_legislators_local_unique
--     on public.legislators (state, locality, role, lower(full_name))
--     where level in ('municipal', 'county');

drop index if exists public.ux_legislators_local_unique;

create unique index ux_legislators_local_unique
  on public.legislators (state, locality, role, lower(full_name))
  where level in ('municipal', 'county') and active;
