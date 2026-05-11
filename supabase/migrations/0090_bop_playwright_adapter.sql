-- ============================================================
-- 0090_bop_playwright_adapter
--
-- The 4 TLS-fingerprint-blocked BoP sites (KS, NH, MA, AR) couldn't
-- be scraped via Node fetch — their WAFs rejected our TLS handshake
-- regardless of headers. This PR adds a Playwright-based adapter
-- that uses a real Chromium browser; this migration re-enables those
-- sources and routes them through the new adapter.
--
-- IMPORTANT: the playwright_browser adapter ONLY runs in environments
-- that can launch Chromium — local dev + GitHub Actions. The Vercel
-- daily cron explicitly excludes adapter='playwright_browser' (see
-- src/modules/bop/engine.ts). A separate GH Actions job runs the
-- browser scrape daily.
-- ============================================================

update public.bop_sources
   set adapter = 'playwright_browser',
       enabled = true,
       last_status = null,
       last_error = null,
       last_scraped_at = null,
       notes = 'TLS-fingerprint-blocked via Node fetch — routes through Playwright '
            || 'Chromium adapter on GitHub Actions daily cron (migration 0090).'
 where state in ('KS', 'NH', 'MA', 'AR');
