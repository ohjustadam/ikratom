-- ============================================================
-- 0332_crawl_stage
--
-- Adds `crawl_stage` to the site_config singleton: how much of the site
-- robots.txt and sitemap.xml invite search engines into.
--
--   0  everything cost-controlled stays blocked (today's behaviour; the default)
--   1  + /research/ and /bills/
--   2  + /legislators/ and /briefings/
--   3  + /library/ and /topics/
--
-- The families that never lift (member content, alerts, campaigns, intel) are
-- not on this scale; see src/lib/crawl-policy.ts.
--
-- src/app/robots.ts and src/app/sitemap.ts read it hourly through
-- src/lib/crawl-stage.ts, so a change needs no deploy. The code fails closed:
-- a missing row, a missing column or a database error all mean stage 0.
-- Only a human raises it (scripts/crawl-stage.mjs set <n>). The hourly
-- crawl_brake job (scripts/crawl-brake.mjs) can only lower it, to 0.
--
-- Rollback:
--   ALTER TABLE public.site_config DROP COLUMN crawl_stage;
-- (The site then reads stage 0, the fully blocked list.)

alter table public.site_config
  add column if not exists crawl_stage smallint not null default 0
    check (crawl_stage between 0 and 3);

comment on column public.site_config.crawl_stage is
  'How much of the site robots.txt and sitemap.xml invite crawlers into: 0 = all cost-controlled families blocked (default), 1 = +research +bills, 2 = +legislators +briefings, 3 = +library +topics. Read hourly by robots.ts / sitemap.ts; unreadable means 0. Raised by a human via scripts/crawl-stage.mjs; lowered to 0 by the hourly crawl_brake job when the Netlify credit meter trips.';
