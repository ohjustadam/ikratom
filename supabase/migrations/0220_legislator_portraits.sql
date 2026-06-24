-- ============================================================
-- 0220 — Legislator portraits (faces everywhere)
-- ============================================================
-- Adds headshot fields to legislators so every officials surface (browser
-- cards, State HQ directory, dashboard rep card, detail-page header + OG
-- image) can render a face with an initials fallback.
--
-- Populated by scripts/sync-official-portraits.mjs from FREE public sources:
--   federal (bioguide_id) -> unitedstates.github.io congress photos (public domain)
--   state   (openstates_id) -> OpenStates person image
--   fallback -> Wikidata P18 (Wikimedia Commons)
-- Optionally cached to Cloudflare R2 when R2_* env is configured; otherwise the
-- validated source https URL is stored directly (CSP img-src already allows
-- any https host). portrait_source records the provenance.
--
-- All columns nullable; render sites fall back to initials when portrait_url is
-- null. No RLS change: legislators SELECT is already public and these are
-- public-record headshots.
--
-- Rollback:
--   drop index if exists legislators_portrait_backfill_idx;
--   alter table public.legislators
--     drop column if exists portrait_url,
--     drop column if exists portrait_source,
--     drop column if exists portrait_synced_at;

alter table public.legislators
  add column if not exists portrait_url text,
  add column if not exists portrait_source text,
  add column if not exists portrait_synced_at timestamptz;

-- Make the sync's "active officials still missing a portrait" scan cheap; the
-- backfill queue shrinks as portraits fill in. Keyed on state so --state runs
-- stay index-assisted.
create index if not exists legislators_portrait_backfill_idx
  on public.legislators (state)
  where active and portrait_url is null;
