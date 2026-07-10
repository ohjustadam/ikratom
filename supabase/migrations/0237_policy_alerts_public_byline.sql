-- ============================================================
-- 0237 — policy_alerts opt-in public byline (additive; ships with the code)
-- ============================================================
-- Security audit 2026-07-10 follow-up (owner ask: "most thorough, give people a
-- choice"). Adds a public-safe attribution string the SERVER sets to the
-- reporter's own @username ONLY when they pick "credit me publicly" at submit
-- (never client-supplied — no impersonation; the raw submitted_by_user_id is
-- never exposed). Three submit states: anonymous (no link), private (linked for
-- admins/trust only), public (shows @username).
--
-- This migration is ADDITIVE and safe to apply before the code deploys (the
-- existing table-level SELECT grant covers the new column). The COMPANION
-- migration 0238 then revokes the blanket SELECT and re-grants only public-safe
-- columns to hide submitted_by_user_id / is_anonymous from the anon key — that
-- one is applied AFTER this code is live (it would break the old code's
-- select("*"), which this release replaces with explicit column lists).
--
-- Rollback: ALTER TABLE public.policy_alerts DROP COLUMN IF EXISTS public_byline;

alter table public.policy_alerts
  add column if not exists public_byline text;
