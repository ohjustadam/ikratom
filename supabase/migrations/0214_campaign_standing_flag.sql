-- 0214_campaign_standing_flag.sql
-- Standing vs rotating campaigns (owner model, 2026-06-22).
--
-- Two classes of campaign:
--   • STANDING — per-state evergreen actions that NEVER expire (the "email your
--     X legislators" backbone, one+ per state). is_standing = true.
--   • ROTATING — auto-generated news campaigns that ride the expiry timer
--     (retired by scripts/expire-rotating-campaigns.mjs once 90d old AND 60d
--     quiet — see that script). is_standing = false (default).
--
-- This column is the protection flag the expiry janitor reads: it NEVER touches
-- a standing campaign. Zero actions alone is NOT a death signal — a state may
-- simply have no users yet — so only OLD + QUIET rotating campaigns retire.
--
-- Backfill: the existing per-state evergreens (slug '<st>-introduce-yourself',
-- "Tell your <State> legislators kratom matters") are the current standing
-- campaigns → flag them so the new expiry janitor can never retire them.
--
-- Rollback: alter table public.campaigns drop column is_standing;

alter table public.campaigns
  add column if not exists is_standing boolean not null default false;

comment on column public.campaigns.is_standing is
  'true = permanent/evergreen campaign, never auto-expired by the rotating-campaign janitor. false (default) = rotating auto-generated campaign subject to the 90d-old + 60d-quiet expiry.';

-- Flag the existing per-state evergreens as standing.
update public.campaigns
   set is_standing = true
 where slug like '%-introduce-yourself'
   and is_standing = false;

-- Partial index for the janitor's "rotating, expiry-eligible" scan.
create index if not exists campaigns_rotating_active_idx
  on public.campaigns (created_at)
  where (active = true and is_standing = false and auto_generated = true);
