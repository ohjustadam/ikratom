-- ============================================================
-- 0100_campaign_review_audit_fields
--
-- Adds bookkeeping fields the admin pending-queue cleanup needs:
--
--   review_reason       — free-text from admin when rejecting/superseding
--                         (e.g. "duplicate of campaign X", "low quality news
--                         source", etc.). Surfaces in the admin UI for audit.
--   superseded_by       — campaign id this row was collapsed into (when an
--                         admin marks duplicates). Null for non-superseded
--                         rejects.
--   reviewed_at         — timestamp of the most recent review_state change.
--                         Combined with admin_audit_log gives a full timeline.
--   reviewed_by         — uuid of the admin who flipped review_state.
--
-- Adds 'superseded' to the review_state values so dedup-collapse is
-- distinguishable from policy-rejection.
-- ============================================================

alter table public.campaigns
  add column if not exists review_reason text,
  add column if not exists superseded_by uuid references public.campaigns(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

-- The existing review_state check (in 0072 or thereabouts) constrains
-- to a set of values. We add 'superseded' for the dedup-collapse case
-- so we don't have to overload 'rejected'. Drop the prior constraint
-- if any exists and re-create with the extra value.
alter table public.campaigns
  drop constraint if exists campaigns_review_state_chk;
alter table public.campaigns
  add constraint campaigns_review_state_chk
  check (review_state is null or review_state in (
    'pending_review',
    'auto_active',
    'manual',              -- legacy: hand-authored campaigns
    'manually_approved',   -- legacy: manually-approved auto-generated
    'rejected',
    'superseded'           -- new in 0100: dedup-collapse target
  ));

create index if not exists ix_campaigns_pending_state_created
  on public.campaigns (state, created_at desc)
  where review_state = 'pending_review';

create index if not exists ix_campaigns_superseded_by
  on public.campaigns (superseded_by)
  where superseded_by is not null;

comment on column public.campaigns.review_reason is
  'Admin-supplied reason when changing review_state. Free-text, capped 500c. Audit visibility on /admin/campaigns/pending.';
comment on column public.campaigns.superseded_by is
  'When set, this row was collapsed into the referenced campaign during dedup. UI hides superseded rows by default.';
