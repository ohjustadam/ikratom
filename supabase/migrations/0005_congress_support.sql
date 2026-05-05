-- Add bioguide_id for federal members (US Congress).
-- Source: github.com/unitedstates/congress-legislators (CC0).

alter table public.legislators
  add column if not exists bioguide_id text;

create unique index if not exists legislators_bioguide_id_uniq
  on public.legislators(bioguide_id)
  where bioguide_id is not null;
