/**
 * Classification + friendly rendering of errors from the four code
 * paths that call Gemini with google_search grounding directly:
 *
 *   - src/lib/ai/suggest-officials.ts (admin inline UI)
 *   - scripts/lib/officials-slate.mjs (extract-news-officials,
 *     seed-bill-officials)
 *   - scripts/auto-fulfill-pending-local-reps.mjs (one-off)
 *   - src/app/api/cron/reverify-local-officials/route.ts (weekly cron)
 *
 * Why this lives here: those callers were each home-rolling a
 * `/429|quota|rate|.../.test(err)` check inline (or, in the case of
 * the admin inline UI, NOT classifying at all and rendering the raw
 * `Gemini 429: ... You exceeded your current quota` as if it were
 * the AI's suggestion). Owner flagged this in V2_KICKOFF §3.A1.
 *
 * Mirror copy at scripts/lib/grounding-errors.mjs (kept in sync by
 * hand — both are ~20 lines).
 */

export type GroundingErrorKind =
  | "quota_exhausted"   // 429 / quota / rate
  | "transient"         // 5xx / network / fetch failed / timeout
  | "parse"             // model didn't return <result> block, JSON broke
  | "auth"              // 401 / 403 / API key missing
  | "other";

export function classifyGroundingError(rawMessage: string | undefined | null): GroundingErrorKind {
  const m = (rawMessage ?? "").toLowerCase();
  if (!m) return "other";
  if (/429|quota|rate.?limit|exceeded.*quota|resource_exhausted/i.test(m)) return "quota_exhausted";
  if (/401|403|api.?key|unauthorized|forbidden/i.test(m)) return "auth";
  if (/500|502|503|504|timeout|timed.?out|fetch failed|econn|network|abort/i.test(m)) return "transient";
  if (/no <result>|could not parse|json|parse/i.test(m)) return "parse";
  return "other";
}

/** True when the caller should retry next run instead of stamping the
 *  row as terminally processed. quota + transient are retryable; parse
 *  + auth + other usually aren't (re-asking won't fix them). */
export function isRetryableGroundingError(rawMessage: string | undefined | null): boolean {
  const kind = classifyGroundingError(rawMessage);
  return kind === "quota_exhausted" || kind === "transient";
}

/** What to show a human admin in place of the raw error string. The
 *  raw string still gets logged (caller side) — this is only for UI. */
export function friendlyGroundingError(rawMessage: string | undefined | null): string {
  const kind = classifyGroundingError(rawMessage);
  switch (kind) {
    case "quota_exhausted":
      return "🕒 Gemini grounded-query quota is exhausted for today. The cron will retry automatically tomorrow (UTC). No action needed — this row stays in the queue.";
    case "transient":
      return "⚠ Temporary network or upstream error. Retry in a minute or wait for the next cron run.";
    case "auth":
      return "🔑 GEMINI_API_KEY is missing or invalid. Check /admin/ai-control → Runtime environment.";
    case "parse":
      return "🤖 The AI returned a malformed response. This usually self-corrects on retry — try again, or wait for the next cron run.";
    default:
      return rawMessage?.slice(0, 200) ?? "Unknown error.";
  }
}
