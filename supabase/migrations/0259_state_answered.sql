-- 0259_state_answered.sql
--
-- WHY (2026-10-03): 18 of 46 members had no state, so they never received
-- home-state alerts, and onboarding let anyone skip the question. The owner
-- made the question REQUIRED with a "Prefer not to say" answer. That answer
-- must be distinguishable from "never asked", and profiles.state alone cannot
-- do that (both are NULL), so this records WHEN the question was answered:
--
--   state set                          -> answered, gets that state's alerts
--   state NULL, state_answered_at set  -> "prefer not to say": the national
--                                         digest already sends them everything
--   state NULL, state_answered_at NULL -> never asked: the site shows a
--                                         required one-question prompt
--
-- No RLS change: profiles UPDATE is already self-only, and the privilege guard
-- trigger only protects role columns.
--
-- ROLLBACK: alter table public.profiles drop column if exists state_answered_at;

alter table public.profiles add column if not exists state_answered_at timestamptz;

-- Everyone who already chose a state has, by definition, answered.
update public.profiles set state_answered_at = coalesce(updated_at, now())
 where state is not null and state <> '' and state_answered_at is null;
