-- 0335_campaign_hold_for_person.sql
--
-- WHY (smart link box, 2026-11-25): a member can paste or share a link about a
-- live bill, and the site may then start a campaign DRAFT for it in the
-- existing review queue (review_state = 'pending_review', active = false).
-- The owner's rule for that path is "never auto-publish": a person approves
-- it. Two automatic approvers can otherwise flip a pending campaign live:
--   * scripts/clear-review-queues.mjs (the grounded twice-daily cron), and
--   * src/modules/admin/queue-resolve-actions.ts ("Auto-resolve all").
-- (scripts/auto-approve-campaigns.mjs only reads auto_generated = true rows,
-- and link-box drafts are auto_generated = false, but it checks the flag too.)
-- This flag marks a draft that only a person may approve. All three skip it.
--
-- Additive and reversible: one boolean, default false, so every existing row
-- and every other writer behaves exactly as before.
--
-- Rollback:
--   drop index if exists public.ix_campaigns_hold_for_person;
--   alter table public.campaigns drop column if exists hold_for_person;

alter table public.campaigns
  add column if not exists hold_for_person boolean not null default false;

comment on column public.campaigns.hold_for_person is
  'True when a person must approve this draft: no automatic approver may publish it (smart link box drafts, mig 0335).';

-- The approvers ask "which pending rows are held?"; keep that lookup tiny.
create index if not exists ix_campaigns_hold_for_person
  on public.campaigns (created_at desc)
  where hold_for_person = true and review_state = 'pending_review';

-- No new table, so no new grants: campaigns keeps its existing table-level
-- grants and RLS (campaigns_admin_all / campaigns_creator_write /
-- campaigns_public_read). A new column on a table-level grant is covered.
