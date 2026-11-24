-- 0328_drop_never_used_indexes.sql
--
-- Database cleanup toward the 500 MB free-plan cap (2026-11-18).
--
-- These six indexes have been scanned zero times since the statistics were
-- last reset on 2026-07-15, i.e. for 126 days. All six come from migrations
-- written before that date (0046, 0063, 0104, 0122, 0223), so zero means
-- "never chosen by the planner", not "too new to count". They hold ~1.8 MB
-- and every write to news_items, bills and ai_jobs still pays to keep them
-- current.
--
-- KEPT ON PURPOSE, although they also show zero scans:
--   * news_items_search_tsv_idx, forum_threads_search_idx, bills_search_idx
--     back full-text search. EXPLAIN on a rare word ("Pasternack") uses the
--     news GIN index; zero scans means nobody searched since July, not that
--     search would work without it (same call as 0252).
--   * every index under 64 KB (2 to 8 pages): dropping it saves nothing.
--   * legislator_news_mentions_news_idx: it serves the ON DELETE path from
--     news_items, which a cleanup is exactly when that runs.
--
-- Rollback (each statement recreates the index exactly as it was):
--   CREATE INDEX idx_ai_jobs_caller ON public.ai_jobs USING btree (caller, created_at DESC);
--   CREATE INDEX idx_ai_jobs_status ON public.ai_jobs USING btree (status, created_at DESC) WHERE (status = 'failure'::text);
--   CREATE INDEX idx_news_items_resolve_pending ON public.news_items USING btree (published_at DESC NULLS LAST) WHERE ((resolved_at IS NULL) AND (active = true) AND (url ~* 'news\.google\.com'::text));
--   CREATE INDEX ix_bills_substance_targeting ON public.bills USING gin (substance_targeting jsonb_path_ops);
--   CREATE INDEX ix_bills_topics ON public.bills USING gin (bill_topics jsonb_path_ops);
--   CREATE INDEX ix_news_items_unpushed_high_relevance ON public.news_items USING btree (published_at DESC) WHERE ((auto_pushed_at IS NULL) AND (ai_relevance_score >= 0.85) AND (body_has_kratom_keyword IS DISTINCT FROM false));

drop index if exists public.idx_ai_jobs_caller;
drop index if exists public.idx_ai_jobs_status;
drop index if exists public.idx_news_items_resolve_pending;
drop index if exists public.ix_bills_substance_targeting;
drop index if exists public.ix_bills_topics;
drop index if exists public.ix_news_items_unpushed_high_relevance;
