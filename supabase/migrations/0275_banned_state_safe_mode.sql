-- 0275_banned_state_safe_mode.sql
--
-- Banned-state safe mode (owner call 2026-10-23, from a Louisiana member's
-- feedback). A member whose profile state bans natural kratom got letters
-- carrying their city, state and ZIP everywhere, and nothing stopped a line
-- like "As a Louisiana resident who relies on kratom" (our own preset
-- example). They changed their profile to Mississippi to feel safe, which
-- made their letters to Oklahoma claim the wrong home.
--
-- Safe mode, while the member's state is 'banned' in state_status:
--   - letters to officials OUTSIDE their state leave out city/state/ZIP;
--   - the composer flags lines that say they use kratom now and offers
--     past-tense wording; Personalize writes in the past tense;
--   - letters to their OWN officials keep city/state (that is what makes
--     them count).
--
-- NULL = never chosen: treated as ON, and the campaign page shows the
-- one-time explainer. true/false = the member's choice. Self-update goes
-- through the existing profiles self-update policy; profiles has table-level
-- grants, so the new column needs no GRANT.
--
-- Rollback: alter table public.profiles drop column if exists banned_state_safe_mode;

alter table public.profiles
  add column if not exists banned_state_safe_mode boolean;

comment on column public.profiles.banned_state_safe_mode is
  'Banned-state letter safety. NULL = not chosen (on), true = on, false = off. See 0275.';
