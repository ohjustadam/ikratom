-- 0129 — Extend state_lobbyist_registrations UNIQUE constraint to include
-- registration_type. Utah lists some lobbyists twice on the same day:
-- once as "Principal" (the lobbyist registered for a direct-paid client)
-- and once as "Business" (the lobbyist registered as a billable firm).
-- These are distinct registrations and both need to be stored.
--
-- Initial migration 0128 used (state, lobbyist_name, principal_name,
-- start_date) which collapses Matthew Salmon's two AKA registrations
-- (both 2026-01-12) into a single conflict target that ON CONFLICT
-- DO UPDATE can't handle in one statement.
--
-- Rollback:
--   ALTER TABLE public.state_lobbyist_registrations
--     DROP CONSTRAINT state_lobbyist_registrations_state_lobbyist_name_principal_n_key1;
--   ALTER TABLE public.state_lobbyist_registrations
--     ADD CONSTRAINT state_lobbyist_registrations_state_lobbyist_name_principal_n_key
--     UNIQUE(state, lobbyist_name, principal_name, start_date);

ALTER TABLE public.state_lobbyist_registrations
  DROP CONSTRAINT IF EXISTS state_lobbyist_registrations_state_lobbyist_name_principal_n_key;

ALTER TABLE public.state_lobbyist_registrations
  ADD CONSTRAINT state_lobbyist_registrations_uniq
  UNIQUE(state, lobbyist_name, principal_name, registration_type, start_date);
