-- Fix: ON CONFLICT can't use a partial unique index (the one created in 0005).
-- Replace with a regular UNIQUE constraint. Postgres allows multiple NULL values
-- in unique constraints, so this still works for the state legislators that
-- don't have a bioguide_id.

drop index if exists public.legislators_bioguide_id_uniq;

alter table public.legislators
  drop constraint if exists legislators_bioguide_id_unique;

alter table public.legislators
  add constraint legislators_bioguide_id_unique unique (bioguide_id);
