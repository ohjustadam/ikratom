-- 0232_direct_outreach_log.sql
--
-- Intent: the new shared email composer (src/modules/compose/) logs DIRECT
-- sends — briefing / bill / directory emails that aren't part of a campaign.
-- Previously only campaign sends were recorded; every other Email CTA was
-- fire-and-forget, so those actions never counted toward the user's record.
--
--   * campaign_id  → nullable  (NULL = direct send, no campaign context)
--   * legislator_id → nullable (NULL = non-legislator recipient, e.g. a bill
--                     stakeholder or a city clerk from local_meta)
--   * source        → new text column tagging the originating surface
--                     ('legislator_briefing', 'bill_committee', ...)
--
-- A CHECK keeps rows meaningful: every row must reference a campaign, a
-- legislator, or at least carry a source tag. Existing rows all have
-- campaign_id set, so the constraint validates cleanly.
--
-- RLS: unchanged — existing self-insert / self-read policies already scope
-- by user_id and don't reference the relaxed columns.
--
-- Rollback:
--   delete from public.campaign_actions where campaign_id is null;
--   alter table public.campaign_actions drop constraint campaign_actions_context_chk;
--   alter table public.campaign_actions alter column campaign_id set not null;
--   alter table public.campaign_actions alter column legislator_id set not null;
--   alter table public.campaign_actions drop column source;

alter table public.campaign_actions alter column campaign_id drop not null;
alter table public.campaign_actions alter column legislator_id drop not null;
alter table public.campaign_actions add column if not exists source text;

alter table public.campaign_actions add constraint campaign_actions_context_chk
  check (campaign_id is not null or legislator_id is not null or source is not null);
