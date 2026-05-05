-- ============================================================
-- 0025 — Embed widget referral tracking
-- ============================================================
-- Adds referred_from column to campaign_actions so we can credit
-- third-party sites (kratom shops, advocacy orgs, etc.) that drive
-- users to the platform via the embed widget.
--
-- Value lives in the column when the user came from an embed click
-- (set via the `embed_ref` cookie captured in proxy.ts when ?ref=embed
-- is in the URL). Stays NULL for direct + organic actions.
-- ============================================================

alter table public.campaign_actions
  add column if not exists referred_from text;

create index if not exists campaign_actions_referred_from_idx
  on public.campaign_actions (referred_from)
  where referred_from is not null;
