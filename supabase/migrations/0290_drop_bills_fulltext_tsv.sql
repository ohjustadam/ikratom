-- 0290_drop_bills_fulltext_tsv.sql
--
-- Database-size prune, step F (owner approved B20, 2026-10-27).
-- The 0.5 GB free database cap never resets and sat at 77% on 2026-10-27.
-- bills.fulltext_tsv (0064) is a STORED generated tsvector over every bill's
-- full text, plus a GIN index on it: ~12.5 MB together. No page, script, RPC,
-- view or function reads it (checked in code and in pg_depend / pg_proc), so
-- it is pure weight. The space returns to the dashboard after
-- `vacuum full public.bills` (prune step G).
--
-- Rollback (exact; Postgres recomputes the column for every row):
--   alter table public.bills add column if not exists fulltext_tsv tsvector
--     generated always as (
--       setweight(to_tsvector('english', coalesce(title, '')), 'A')
--       || setweight(to_tsvector('english', coalesce(summary_long, '')), 'B')
--       || setweight(to_tsvector('english', coalesce(summary_ai, '')), 'B')
--       || setweight(to_tsvector('english', coalesce((bill_text_versions -> -1 ->> 'text'), '')), 'C')
--     ) stored;
--   create index if not exists ix_bills_fulltext_tsv on public.bills using gin (fulltext_tsv);

drop index if exists public.ix_bills_fulltext_tsv;
alter table public.bills drop column if exists fulltext_tsv;
