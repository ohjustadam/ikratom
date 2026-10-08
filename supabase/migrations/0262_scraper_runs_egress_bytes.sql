-- ============================================================
-- 0262_scraper_runs_egress_bytes
--
-- Per-job Supabase egress. scripts/lib/egress-meter.mjs is preloaded into every
-- cron script (node --import=...) and stamps each scraper_runs row with the
-- estimated wire bytes that run pulled from Supabase. Until now only the
-- project total was visible, so "which job is expensive" was a guess, and the
-- free plan's 5 GB/month cap is what pauses the fleet and, at 100%, the site.
--
-- Nullable: rows from unmetered runs (and every row before this) stay NULL,
-- which reads as "not measured", never as zero.
--
-- Rollback: alter table public.scraper_runs drop column if exists egress_bytes;
-- ============================================================

alter table public.scraper_runs add column if not exists egress_bytes bigint;

comment on column public.scraper_runs.egress_bytes is
  'Estimated Supabase egress (wire bytes) this run pulled; set by scripts/lib/egress-meter.mjs. NULL = not metered.';

create index if not exists scraper_runs_egress_recent_idx
  on public.scraper_runs (started_at desc) where egress_bytes is not null;
