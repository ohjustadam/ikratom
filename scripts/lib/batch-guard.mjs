/**
 * Shared fail-streak circuit breaker + error capture for batch scripts.
 *
 * Problem this solves: the AI-backed extractor crons (classify-news-
 * policy, extract-news-events, extract-local-meta, …) loop over N items
 * and call the free-tier AI router per item. When the cloud providers'
 * daily/per-minute free quotas are exhausted, EVERY remaining item fails
 * with "all providers failed" — the script grinds through all N anyway
 * (wasting the next hour's quota the moment it refreshes) and records a
 * useless "0 done, N failed" with an EMPTY error_message, so /admin
 * /intel-health shows a red run with no cause.
 *
 * makeFailGuard() gives each loop:
 *   - guard.ok()      — call on a successful item (resets the streak)
 *   - guard.fail(err) — call on a failed item; returns TRUE when the
 *                       consecutive-failure threshold trips → caller
 *                       should `break` out of the loop (providers are
 *                       down; stop burning quota).
 *   - guard.note()    — human-readable summary for scraper_runs.error_message
 *   - guard.status(successCount) — "success" | "empty" | "error",
 *                       error only on a tripped breaker or all-fail.
 *
 * Skips / no-ops are NOT failures — only pass real errors to fail().
 */
export function makeFailGuard({ threshold = 8 } = {}) {
  let streak = 0;
  let failures = 0;
  let lastError = null;
  return {
    ok() { streak = 0; },
    /** Record a real error. Returns true once the breaker trips. */
    fail(err) {
      streak++;
      failures++;
      lastError = String(err?.message ?? err).slice(0, 400);
      return streak >= threshold;
    },
    get tripped() { return streak >= threshold; },
    get failures() { return failures; },
    get lastError() { return lastError; },
    /** error_message text for scraper_runs (null when nothing failed). */
    note() {
      if (!failures) return null;
      const brk = this.tripped ? " — circuit breaker tripped (AI providers exhausted; stopped early to preserve quota)" : "";
      return `${failures} item(s) failed${brk}; last: ${lastError}`;
    },
    /**
     * Run status. A tripped breaker or an all-failed run is "error".
     * A run with some successes (even alongside a few transient item
     * failures) is "success" — one flaky call shouldn't paint the whole
     * run red.
     */
    status(successCount) {
      if (this.tripped) return "error";
      if (failures > 0 && successCount === 0) return "error";
      return successCount === 0 ? "empty" : "success";
    },
  };
}
