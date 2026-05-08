-- ============================================================
-- 0055_legislator_dedupe
--
-- Prevents accidental duplicate inserts of the same local official.
-- Without this, re-running /admin/locals/suggest for the same area
-- (e.g. clicking Search twice) would create two "Pat Byrne" rows in
-- the same locality + role.
--
-- Composite unique index — partial, only enforces on local-level
-- (municipal/county) rows where the same person is the actual
-- duplication risk. Federal + state legislators come from OpenStates
-- and are already deduped by external_id during sync.
--
-- Case-insensitive on full_name to catch "Pat Byrne" vs "pat byrne"
-- vs "PAT BYRNE" duplicates.
-- ============================================================

create unique index if not exists ux_legislators_local_unique
  on public.legislators (state, locality, role, lower(full_name))
  where level in ('municipal', 'county');
