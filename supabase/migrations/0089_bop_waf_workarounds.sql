-- ============================================================
-- 0089_bop_waf_workarounds
--
-- After PR #110 (classifier fix) + the hardened HTTP headers in
-- generic_html, smoke-tested every previously-403'd state. Findings:
--
-- ✓ Headers alone unblock: MI, WA (and others previously borderline)
-- ✓ Referer:Google unblocks: TN
-- ✓ Homepage instead of /public-meetings unblocks: AZ
-- ✗ Still TLS-fingerprint-blocked (need a headless browser): KS, NH, MA, AR
--
-- This migration:
-- 1. Points AZ at the homepage (which works) instead of /public-meetings.
-- 2. Clears last_status on the 4 expected-to-now-work states so the
--    next cron walk retries them with the new headers.
-- 3. Disables the 4 TLS-blocked sites and notes WHY so we don't keep
--    spamming errors. They stay in the table so a future Playwright/
--    Puppeteer adapter PR can re-enable them. Their state news is
--    still covered by the daily Google News sweep.
-- ============================================================

-- 1. AZ: homepage works, /public-meetings doesn't.
update public.bop_sources
   set agenda_url = 'https://pharmacy.az.gov/',
       last_status = null,
       last_error = null,
       last_scraped_at = null,
       notes = 'WAF blocks /public-meetings subpath but homepage is reachable (migration 0089).'
 where state = 'AZ';

-- 2. Clear last_status on MI, WA, TN so they retry fresh with new headers.
update public.bop_sources
   set last_status = null,
       last_error = null,
       last_scraped_at = null
 where state in ('MI', 'WA', 'TN');

-- 3. Disable the 4 TLS-fingerprint-blocked sites with explanatory notes.
-- Their state news is still picked up by the daily Google News sweep.
update public.bop_sources
   set enabled = false,
       notes = 'WAF blocks all non-browser requests via TLS fingerprinting (JA3). '
            || 'Cannot scrape with Node fetch; needs a headless-browser adapter '
            || '(deferred). State news on kratom is still covered by Google News sweep.',
       last_status = 'error',
       last_error = 'TLS fingerprint blocked — needs headless-browser adapter'
 where state in ('KS', 'NH', 'MA', 'AR');
