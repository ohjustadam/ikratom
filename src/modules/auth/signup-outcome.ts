/**
 * What a signup attempt or an emailed auth link actually did, kept pure so it
 * can be tested without Supabase.
 *
 * Member report, 2026-11-09: "I have clicked on the email confirmation link
 * multiple times and it doesn't do anything." Three things combined:
 *
 *  1. signUp() sent no emailRedirectTo, so Supabase sent every confirm link to
 *     the Site URL. The link DID confirm the email, then dropped the person on
 *     the homepage with an unused ?code=, still signed out, with no message.
 *  2. Signing up again for a pending address re-sends the link. Inside a
 *     minute Supabase refuses with "For security purposes, you can only request
 *     this after 26 seconds", which the form showed word for word.
 *  3. A second signup never changes the password: Supabase keeps the first
 *     one. So people who confirmed later typed the newer password and got
 *     "Invalid login credentials".
 *  4. Since migration 0310 (2026-11-04) the username step errored for every
 *     new member ("permission denied for function is_owner"), so the form
 *     said signup failed when the account had been made. Fixed in actions.ts.
 */

/** How long after creation an account still counts as made by THIS request. */
export const FRESH_ACCOUNT_MS = 2 * 60 * 1000;

export type SignUpKind =
  /** A new account. Supabase is sending the confirmation link. */
  | "created"
  /** The address already had an unconfirmed account. Supabase sent a fresh link. */
  | "resent"
  /** The address already has a confirmed account. Supabase sent nothing. */
  | "existing_confirmed"
  /** A link went to this address under a minute ago. Nothing new was sent. */
  | "wait"
  /**
   * Supabase could not send ANY confirmation email: the project-wide hourly
   * cap (rate_limit_email_sent) or the mail provider's daily quota is used up.
   * Supabase rolled the signup back, so no account exists and nothing was sent.
   */
  | "capacity"
  | "error";

type SignUpUser = {
  id?: string;
  created_at?: string;
  identities?: unknown[] | null;
} | null | undefined;

type SignUpError = { code?: string | null; message?: string | null } | null | undefined;

export function classifySignUp(input: {
  error: SignUpError;
  user: SignUpUser;
  now?: number;
}): SignUpKind {
  const { error, user } = input;
  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    // One error code, two meanings (2026-11-17 scale audit). "For security
    // purposes, you can only request this after N seconds" is about THIS
    // address: a link really is in its inbox. "Email rate limit exceeded" is the
    // whole project's hourly cap (30/hour): Supabase rolled the signup back and
    // sent nothing. Calling that "wait" told people to check an inbox that
    // would stay empty and not to sign up again, so a rush lost every signup
    // past the 30th in an hour without a trace.
    if (isEmailCapacityError(error)) return "capacity";
    if (error.code === "over_email_send_rate_limit" || msg.includes("only request this after")) {
      return "wait";
    }
    if (
      error.code === "user_already_exists" ||
      error.code === "email_exists" ||
      msg.includes("already registered") ||
      msg.includes("already been registered") ||
      msg.includes("user already exists") ||
      msg.includes("email exists")
    ) {
      return "existing_confirmed";
    }
    return "error";
  }
  if (!user) return "error";
  // With email confirmation on, Supabase hides a confirmed account behind a
  // stand-in user that has no identities, so the response looks like success.
  if (Array.isArray(user.identities) && user.identities.length === 0) return "existing_confirmed";
  const created = Date.parse(user.created_at ?? "");
  const now = input.now ?? Date.now();
  if (Number.isFinite(created) && now - created > FRESH_ACCOUNT_MS) return "resent";
  return "created";
}

/**
 * True when Supabase could send no confirmation email at all, as opposed to
 * refusing a second email to the same address within a minute.
 *  - "Email rate limit exceeded" (429, over_email_send_rate_limit): the
 *    project-wide hourly cap.
 *  - "Error sending confirmation email" (500): the SMTP provider refused, which
 *    on our free tier means its daily quota is gone (Resend: 100 per UTC day).
 * Either way the signup was rolled back.
 */
export function isEmailCapacityError(error: SignUpError): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("only request this after")) return false;
  return msg.includes("email rate limit exceeded") || msg.includes("error sending confirmation email");
}

/**
 * What the form says when the account was made but its confirmation email is
 * queued behind a rush (see send-queued-signup-links.mjs). True, and it tells
 * them not to sign up again, which would only queue the same email twice.
 */
export const SIGNUP_QUEUED_MESSAGE =
  "You're signed up. A lot of people are joining right now, so your confirmation email is in a queue: it should arrive within a few hours. Tap the link in it to sign in. No need to sign up again.";

/**
 * What the form says after a signup that did not fail validation. One message
 * for every outcome, so nobody can learn from it whether an address has an
 * account. It tells a new member, a returning one and a retrying one the same
 * true thing: the newest email holds the working link, and it signs them in.
 */
export const SIGNUP_SENT_MESSAGE =
  "Check your email. Tap the link in the newest message from iKratom: it confirms your address and signs you in. It can take a minute, so check spam too. No need to sign up again.";

/** Shown with the message above, for people who signed up before. */
export const SIGNUP_SENT_HINT =
  "Signed up before? Your password is the one you chose the first time. If you don't remember it, tap the email link, or reset your password.";

/**
 * Where an emailed auth link that could not sign someone in should land.
 *
 * - A failed password reset goes back to /forgot, which says so and can re-send.
 * - A ?code= exists only after Supabase verified the link, so the address IS
 *   confirmed. The exchange fails when the link opened in a different browser
 *   or a mail app's own browser (no PKCE verifier there), or on a second tap.
 *   That person only needs to sign in, and should be told so.
 * - Anything else (expired, replaced by a newer email, already used) gets a
 *   page that explains it and can send a new link.
 */
export function authLinkFailurePath(opts: { isRecovery: boolean; hadCode: boolean }): string {
  if (opts.isRecovery) return "/forgot?expired=1";
  if (opts.hadCode) return "/login?notice=confirmed";
  return "/login?notice=link_expired";
}

export type AuthNoticeKind = "confirmed" | "link_expired";

export function parseAuthNotice(raw: string | null | undefined): AuthNoticeKind | null {
  return raw === "confirmed" || raw === "link_expired" ? raw : null;
}
