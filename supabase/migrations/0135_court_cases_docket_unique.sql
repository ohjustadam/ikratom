-- 0135 — Add UNIQUE on cl_docket_id for the docket-side syncs.
--
-- Migration 0134 set UNIQUE(cl_cluster_id) which works for OPINION
-- rows (every opinion has a cluster_id). RECAP DOCKET rows don't
-- have a cluster_id — they have docket_id only. The dedup script
-- needs a UNIQUE to UPSERT against on the docket side.
--
-- Postgres UNIQUE allows multiple NULLs in the same column, so
-- adding UNIQUE(cl_docket_id) doesn't conflict with the existing
-- opinion rows where cl_docket_id may be null (an opinion belongs
-- to a docket but might not always have docket_id populated).
--
-- Rollback:
--   ALTER TABLE public.court_cases DROP CONSTRAINT court_cases_cl_docket_id_key;

ALTER TABLE public.court_cases
  ADD CONSTRAINT court_cases_cl_docket_id_key UNIQUE (cl_docket_id);

CREATE INDEX IF NOT EXISTS court_cases_kind_idx
  ON public.court_cases (case_kind, date_filed DESC);
