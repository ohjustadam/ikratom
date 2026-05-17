-- 0148 — Term tracking for legislators (especially local officials).
--
-- Owner directive 2026-05-16: "it would be wise of us to put in a
-- failsafe way now to auto update and recognize the officials so we
-- ensure we dont list someone that is no longer an official because we
-- havent updated it with the new officials. maybe we do this by
-- verifying what date they will be serving until as soon as we pull
-- their info then note our automation system when to decommision and
-- replace them."
--
-- Three new columns power a re-verification safeguard against stale
-- officials (resignations, lost re-elections, term expirations):
--
--   term_start_date  — when the official's current term started
--   term_end_date    — when it's scheduled to end (key field for
--                      auto-retirement)
--   verified_sources_md — markdown list of URLs the AI suggester
--                      cited as proof of the official's role. Useful
--                      both for admin review + for periodic re-verify.
--
-- `last_synced_at` already exists and serves as "when did we last
-- check this person" for the re-verify cron.
--
-- Re-verify flow (scheduled, see scripts/reverify-local-officials.mjs):
--   1. WHERE term_end_date IS NOT NULL AND term_end_date < NOW()
--      → mark active = false, log to admin queue, kick off re-suggest
--   2. WHERE last_synced_at < NOW() - INTERVAL '90 days' AND level
--      IN ('municipal','county')
--      → re-run AI suggest for the locality, compare names. If an
--        active official isn't in the new suggestion set from 3
--        providers, mark stale + queue admin review.
--
-- Rollback:
--   ALTER TABLE legislators DROP COLUMN term_start_date,
--                           DROP COLUMN term_end_date,
--                           DROP COLUMN verified_sources_md;

alter table public.legislators
  add column if not exists term_start_date date,
  add column if not exists term_end_date date,
  add column if not exists verified_sources_md text;

create index if not exists ix_legislators_term_end on public.legislators (term_end_date)
  where term_end_date is not null and active = true;

create index if not exists ix_legislators_local_active_synced on public.legislators (level, active, last_synced_at)
  where level in ('municipal', 'county');

comment on column public.legislators.term_start_date is
  '0148: term start (when known). Local officials often have variable terms; cron uses this + term_end_date to schedule re-verification.';
comment on column public.legislators.term_end_date is
  '0148: scheduled end of term. When NOW() crosses this, the official is auto-marked inactive and a re-suggest queued for the locality.';
comment on column public.legislators.verified_sources_md is
  '0148: markdown list of URLs the AI suggester cited. Admin can spot-check. Future re-verify can re-fetch these to confirm officials are still listed.';
