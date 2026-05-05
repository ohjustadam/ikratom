-- ============================================================
-- 0024 — Auto-generated campaigns from new anti-kratom bills
-- ============================================================
-- When the daily cron sync detects a new anti-kratom bill (kratom_relevance
-- = 'anti' AND relevance_confidence >= 0.6 AND no existing campaign), we
-- auto-create a "respond to this bill" campaign. Adding a marker column +
-- a unique partial index so the same bill never spawns two auto-campaigns.
--
-- The existing `notify_users_for_campaign` trigger fires on campaign INSERT
-- and respects users' notification preferences — so "new bill drops →
-- matched users get notified" is fully covered without a new trigger.
-- ============================================================

alter table public.campaigns
  add column if not exists auto_generated boolean not null default false;

-- One auto-generated campaign per bill (we can still hand-write a separate
-- campaign for the same bill — auto_generated=false rows aren't constrained).
create unique index if not exists campaigns_one_auto_per_bill_idx
  on public.campaigns (bill_id)
  where auto_generated = true and bill_id is not null;

create index if not exists campaigns_auto_generated_idx
  on public.campaigns (auto_generated, created_at desc);
