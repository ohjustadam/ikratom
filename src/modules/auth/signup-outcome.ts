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
