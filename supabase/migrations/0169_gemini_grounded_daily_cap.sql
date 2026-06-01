-- 0169_gemini_grounded_daily_cap.sql
--
-- Admin-tunable per-day cap on grounded Gemini queries.
--
-- Background: Gemini 2.5 Flash with google_search grounding is the only
-- provider that can find current local officials, so it's the sole path
-- for officials-slate seeding (extract-news-officials.mjs, seed-bill-
-- officials.mjs, /admin/local-rep-requests, /api/cron/reverify-local-
-- officials). Unlike non-grounded Gemini calls (1M tokens/day), grounded
-- queries share a much smaller daily allotment (~500/project/day on
-- free tier). The Sunday weekly cron was blowing it in one tick, after
-- which every admin click in /admin/local-rep-requests returned a raw
-- "Gemini 429: ... You exceeded your current quota" string and stayed
-- broken for the rest of the day.
--
-- This cap is enforced in src/lib/ai/grounding-budget.ts +
-- scripts/lib/grounding-budget.mjs by counting today's ai_jobs rows
-- where task_kind='gemini_grounded' and refusing new calls once the cap
-- is hit (callers get a typed 'quota_exhausted' error, UI shows a
-- friendly "retry tomorrow" instead of the raw 429).
--
-- Default 400 leaves ~100-call headroom for ad-hoc admin clicks.
-- Tunable from /admin/ai-control without a deploy.
--
-- Rollback: drop the column.

ALTER TABLE public.site_config
  ADD COLUMN IF NOT EXISTS gemini_grounded_daily_cap int NOT NULL DEFAULT 400;

COMMENT ON COLUMN public.site_config.gemini_grounded_daily_cap IS
  'Max grounded Gemini queries per UTC day before assertGroundingBudget() throws quota_exhausted. Default 400 leaves headroom under the ~500/day free-tier ceiling.';

-- Speeds the today-count query that the budget guard runs on every
-- grounded call. Without this, the count scans every ai_jobs row from
-- today across all task_kinds — fine at v1 volume, painful as ai_jobs
-- grows.
CREATE INDEX IF NOT EXISTS idx_ai_jobs_grounded_today
  ON public.ai_jobs (created_at)
  WHERE task_kind = 'gemini_grounded';
