-- ============================================================
-- 0030 — Deep bill analysis + admin review queue
-- ============================================================
-- Two related fixes for the SB-557 problem (auto-classifier got the
-- stance wrong because it only saw the title):
--
-- 1) Persist deep-analysis flags from PDF-text reading. A bill can
--    target 'natural_leaf' (anti-everything-kratom), 'synthetic_only'
--    (7-OH-restriction, plain-leaf-protective), or both. Auto-create
--    only fires for natural-leaf-targeting bills.
--
-- 2) Admin review queue: medium-confidence auto-classifications no
--    longer go straight to active=true. They land in /admin/campaigns/pending
--    for explicit approval.
-- ============================================================

alter table public.bills
  add column if not exists targets_natural_leaf boolean,
  add column if not exists targets_synthetic_only boolean,
  add column if not exists deep_analyzed_at timestamptz;

-- ── campaigns.review_state ──────────────────────────────────
-- 'auto_active'    — auto-generated, high-confidence + natural-leaf, live
-- 'pending_review' — auto-generated, awaiting admin approval (NOT public)
-- 'rejected'       — admin reviewed and decided not to publish
-- 'manual'         — created by admin, no review needed (legacy default)
alter table public.campaigns
  add column if not exists review_state text not null default 'manual'
  check (review_state in ('manual','auto_active','pending_review','rejected'));

-- Backfill existing auto-generated rows so they don't all show up as
-- 'manual' incorrectly. Anything currently active was auto_active;
-- anything inactive was either rejected by cleanup or manually deactivated.
update public.campaigns
  set review_state = case
    when auto_generated = true and active = true then 'auto_active'
    when auto_generated = true and active = false then 'rejected'
    else 'manual'
  end
  where review_state = 'manual';

create index if not exists campaigns_review_pending_idx
  on public.campaigns (review_state, created_at desc)
  where review_state = 'pending_review';

-- ── wave reminders ──────────────────────────────────────────
-- Track which signups already got the 1-hour-pre-fire reminder so we
-- don't double-send if the cron runs more than once in that window.
alter table public.campaign_wave_signups
  add column if not exists reminder_sent_at timestamptz;
