-- 0130 — Final-form UNIQUE constraint on state_lobbyist_registrations.
--
-- Migration 0129 tried to drop the auto-named constraint from 0128 but
-- Postgres named it `state_lobbyist_registrations_state_lobbyist_name_principal__key`
-- (note the truncation to 63 chars — different from the name I guessed),
-- so the DROP IF EXISTS was a no-op and the old 4-tuple constraint
-- stuck around alongside the new 5-tuple one.
--
-- This migration drops every UNIQUE constraint on the table and
-- reinstates only the 5-tuple version. Using a DO block to discover
-- the actual names from pg_constraint.
--
-- Rollback: drop the constraint by its new name and recreate the old:
--   ALTER TABLE public.state_lobbyist_registrations DROP CONSTRAINT state_lobbyist_registrations_uniq;
--   ALTER TABLE public.state_lobbyist_registrations ADD CONSTRAINT state_lobbyist_registrations_state_lobbyist_name_principal_n_key
--     UNIQUE(state, lobbyist_name, principal_name, start_date);

DO $$
DECLARE
  c record;
BEGIN
  -- Drop any existing UNIQUE constraint on this table (the 0128
  -- auto-named one and the 0129 explicit one, whichever survived).
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.state_lobbyist_registrations'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.state_lobbyist_registrations DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.state_lobbyist_registrations
  ADD CONSTRAINT state_lobbyist_registrations_uniq
  UNIQUE(state, lobbyist_name, principal_name, registration_type, start_date);
