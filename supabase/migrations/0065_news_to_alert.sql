-- ============================================================
-- 0065_news_to_alert
--
-- Wire news_items → policy_alerts so the auto-pipeline can:
--   1. Track which news items have been classified for policy events
--   2. Link a generated alert back to the source news_item
--
-- Without this, the classifier would re-process the same items every
-- run AND we'd lose the audit trail of which article spawned a given
-- alert.
-- ============================================================

alter table public.news_items
  add column if not exists policy_classified_at timestamptz,
  add column if not exists policy_event_score numeric,    -- 0-1 AI confidence the article describes a policy event
  add column if not exists policy_event_kind text,         -- city_ordinance | state_bill | bop_action | ag_enforcement | court_ruling | fda_action | other
  add column if not exists policy_alert_id uuid references public.policy_alerts(id) on delete set null;

create index if not exists ix_news_items_policy_unclassified
  on public.news_items (scraped_at desc)
  where policy_classified_at is null;

create index if not exists ix_news_items_policy_alert
  on public.news_items (policy_alert_id)
  where policy_alert_id is not null;
