-- 0281_bop_sources_baseline_null.sql
--
-- bop_sources.last_finding_count NULL now means "never walked successfully",
-- which the BoP engine (scripts/lib/bop-engine.mjs, since #1024) reads as a
-- baseline walk: that walk's findings are marked is_baseline (0279), so the
-- source's backlog alerts as pending instead of auto-publishing. The column
-- was NOT NULL DEFAULT 0, so scripts/register-state-intel-sources.mjs could
-- not insert the marker and its first --apply run inserted nothing.
-- The engine writes a count on every successful walk; existing rows keep theirs.
--
-- Rollback: update public.bop_sources set last_finding_count = 0 where last_finding_count is null;
--           alter table public.bop_sources alter column last_finding_count set not null;

alter table public.bop_sources alter column last_finding_count drop not null;
alter table public.bop_sources alter column last_finding_count drop default;
