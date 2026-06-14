-- ============================================================
-- 0203_live_only_auto_campaign_per_bill
--
-- Narrow campaigns_one_auto_per_bill_idx so a DEAD auto-campaign no
-- longer squats the "one auto-campaign per bill" slot.
--
-- The index was UNIQUE on (bill_id) WHERE auto_generated AND bill_id IS NOT
-- NULL — with no live-filter. So once the autonomy engine rejected or
-- superseded a bill's auto-campaign (e.g. stop-ny-s5531 = rejected,
-- stop-az-hb2415 = superseded), that corpse permanently held the bill's slot
-- and a LIVE orphan campaign for the same bill could never link to it
-- (a bill_id UPDATE threw 23505). That left active campaigns with bill_id=NULL
-- forever — they couldn't render the bill chip / inherit the bill's own news.
--
-- Fix: only constrain LIVE auto-campaigns (review_state not rejected/superseded).
-- The intent — "at most one live auto-campaign per bill" — is preserved; dead
-- campaigns release their slot. Verified safe before writing: 0 bills currently
-- have 2+ non-(rejected|superseded) auto-campaigns, so the unique index builds
-- cleanly. Self-healing going forward: the engine keeps producing dead
-- stop-campaigns, and their corpses will stop blocking live orphans.
--
-- Rollback: drop this index and recreate the old predicate
--   WHERE (auto_generated = true AND bill_id IS NOT NULL).
-- ============================================================

drop index if exists public.campaigns_one_auto_per_bill_idx;

create unique index campaigns_one_auto_per_bill_idx
  on public.campaigns (bill_id)
  where (
    auto_generated = true
    and bill_id is not null
    and review_state <> 'rejected'
    and review_state <> 'superseded'
  );
