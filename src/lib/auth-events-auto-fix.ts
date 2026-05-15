/**
 * Auto-fix classifier for auth_events.
 *
 * Owner directive 2026-05-15: "automate the fix process before it lands
 * in our pending review so it only ends up in pending review if you are
 * unable to fix it for some reason."
 *
 * This module classifies every failure event into one of five outcomes.
 * The first three never reach the admin surface; the last two do.
 *
 *   resolved_user_side  — wrong_password, access_denied, etc. No admin
 *                         action required. Hidden from the alert panel.
 *   resolved_transient  — token_exchange, token_fetch. Likely network
 *                         blip; if it keeps happening, error_code will
 *                         shift to something we DO escalate.
 *   resolved_dismissed  — bad_state. Cookie/CSRF retry; user retries
 *                         usually fixes it.
 *   escalated_config    — redirect_uri_mismatch, invalid_client,
 *                         db_signup. Admin MUST act (env / console drift).
 *   escalated_unknown   — error_code we don't recognize. Surface to
 *                         admin so they can triage + we can extend this
 *                         classifier.
 *
 * Pure function — no DB / IO. The caller (recordAuthEvent) writes the
 * outcome back to the row.
 */

export type AutoFixOutcome =
  | "resolved_user_side"
  | "resolved_transient"
  | "resolved_dismissed"
  | "escalated_config"
  | "escalated_unknown";

export type AutoFixVerdict = {
  outcome: AutoFixOutcome;
  /** True iff the verdict is escalated_* (admin needs to see it). */
  escalated: boolean;
  /** One-line note logged with the row for transparency. */
  notes: string;
};

/**
 * Classify a single failure event. Inputs are the row's structured
 * fields — never the user's PII.
 */
export function attemptAutoFix(input: {
  kind: string;
  provider: string | null;
  errorCode: string | null;
  /** Count of events with same (kind, provider, error_code) in last 24h,
   *  pre-insert. Used to escalate transient errors that keep recurring. */
  recurrenceCount24h?: number;
}): AutoFixVerdict {
  const code = (input.errorCode ?? "").trim();

  // No error_code at all but status=fail → admin should triage.
  if (!code) {
    return {
      outcome: "escalated_unknown",
      escalated: true,
      notes: "No error_code on a failed event; classifier cannot recover.",
    };
  }

  // User-side errors. Never escalate — the user just made a typo or
  // cancelled the consent screen. Aggregation would only be useful for
  // abuse-detection, which lives elsewhere.
  if (
    code === "wrong_password" ||
    code === "invalid_credentials" ||
    code === "access_denied" ||
    code === "user_cancelled" ||
    code === "consent_denied" ||
    code === "email_not_confirmed"
  ) {
    return {
      outcome: "resolved_user_side",
      escalated: false,
      notes: `User-side error (${code}). No admin action — user retries fixes it.`,
    };
  }

  // Transient network errors. Don't escalate the first few — but if the
  // same code recurs many times in a window, the network problem is
  // sustained and admin should look at Vercel runtime logs.
  if (code === "token_exchange" || code === "token_fetch" || code === "network_error") {
    if ((input.recurrenceCount24h ?? 0) >= 5) {
      return {
        outcome: "escalated_unknown",
        escalated: true,
        notes: `Transient (${code}) recurring ${input.recurrenceCount24h}× in 24h — likely sustained outage, not a blip.`,
      };
    }
    return {
      outcome: "resolved_transient",
      escalated: false,
      notes: `Likely transient network blip (${code}). Will self-resolve on user retry.`,
    };
  }

  // Cookie / CSRF state. User retry usually fixes it (third-party-cookie
  // policy, fresh tab, etc). Only escalate if it's spiking.
  if (code === "bad_state" || code === "state_expired" || code === "missing_state") {
    if ((input.recurrenceCount24h ?? 0) >= 10) {
      return {
        outcome: "escalated_config",
        escalated: true,
        notes: `${code} recurring ${input.recurrenceCount24h}× in 24h — cookie SameSite or proxy.ts may be broken.`,
      };
    }
    return {
      outcome: "resolved_dismissed",
      escalated: false,
      notes: `Cookie/CSRF retry (${code}). User retry typically clears.`,
    };
  }

  // True config drift. Admin MUST act. These are the ones we built the
  // /admin/oauth-config surface for.
  if (
    code === "redirect_uri_mismatch" ||
    code === "invalid_client" ||
    code === "invalid_grant" ||
    code === "unauthorized_client" ||
    code === "Database error saving new user" ||
    code === "db_signup" ||
    code === "no_refresh"
  ) {
    return {
      outcome: "escalated_config",
      escalated: true,
      notes: `Config drift (${code}). Admin must update env or developer console.`,
    };
  }

  // Anything else — bubble up so admin can triage + we extend this
  // classifier with each new pattern we learn.
  return {
    outcome: "escalated_unknown",
    escalated: true,
    notes: `Unrecognized error_code (${code}). Admin triage needed; extend classifier with the pattern.`,
  };
}
