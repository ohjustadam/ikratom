-- 0108: Add partial unique index for campaign topic-key dedup.
--
-- Migration 0107 added topic_key + back-fill. The scripts/cleanup-
-- pending-campaigns.mjs run then collapsed the remaining live/pending
-- clusters down to one campaign per topic. This migration locks in
-- that invariant — at the DB level, no two LIVE campaigns can share
-- a topic_key.
--
-- The trg_auto_campaign_on_alert trigger + auto-campaign-from-alert.mjs
-- script will catch unique_violation (23505) on this index and link
-- the policy_alert's campaign_id to the existing canonical campaign
-- instead of inserting a new row.
--
-- The "unknown|unknown" exclusion exists because some titles don't
-- match any kratom keyword + event word — those produce a non-
-- specific key like "FL|unknown|unknown" and shouldn't dedup against
-- each other (different events that happen to be unparsable).
--
-- Rollback: DROP INDEX IF EXISTS ux_campaigns_topic_key_live;

create unique index if not exists ux_campaigns_topic_key_live
  on public.campaigns (topic_key)
  where review_state in ('pending_review', 'auto_active', 'manual')
    and topic_key is not null
    and topic_key !~ '\|unknown\|unknown$';

comment on index public.ux_campaigns_topic_key_live is
  'At most one live/pending campaign per topic cluster. Triggers + auto-create scripts catch the unique-violation and link the new alert to the canonical instead of inserting. See migration 0107 + 0108.';
