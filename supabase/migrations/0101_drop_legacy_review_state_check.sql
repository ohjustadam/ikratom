-- ============================================================
-- 0101_drop_legacy_review_state_check
--
-- Migration 0100 added campaigns_review_state_chk (with 'superseded').
-- But the table also had a legacy constraint named
-- campaigns_review_state_check (no 'superseded') that was never
-- dropped, so UPDATEs setting review_state='superseded' still fail.
-- Drop the legacy one — the new _chk one is the source of truth.
-- ============================================================

alter table public.campaigns
  drop constraint if exists campaigns_review_state_check;
