-- ============================================================
-- 0006 — Support for local (city/county) officials
-- ============================================================
-- We extend the existing legislators table rather than splitting it.
-- Local officials live alongside state/federal — different `level`, plus
-- locality/body/title text describing the local government structure.

alter table public.legislators
  add column if not exists level text,           -- 'federal' | 'state' | 'county' | 'municipal'
  add column if not exists locality text,        -- e.g. 'Austin, TX' or 'Travis County, TX'
  add column if not exists body text,            -- e.g. 'Austin City Council'
  add column if not exists title text;           -- e.g. 'Mayor' or 'Council Member, District 4'

-- Backfill level from existing role values
update public.legislators
set level = case
  when role like 'us_%' then 'federal'
  when role like 'state_%' then 'state'
end
where level is null;

create index if not exists legislators_level_idx on public.legislators(level);
create index if not exists legislators_locality_idx on public.legislators(locality);

-- Allow NULL openstates_id for locally-entered officials (already nullable, but document)
-- Roles for local: 'mayor', 'city_council', 'county_executive', 'county_commissioner',
--                  'school_board', 'other_local'

-- ============================================================
-- Campaigns: per-locality targeting + explicit recipient overrides
-- ============================================================
alter table public.campaigns
  add column if not exists target_locality text,                 -- e.g. 'Austin, TX'
  add column if not exists target_legislator_ids uuid[] default null;
-- target_legislator_ids: when set, this is the EXACT list of recipients
-- (overrides target_roles + state + locality matching). Used by the wizard
-- when a campaign creator hand-picks specific officials.
