import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hold a signup that Supabase turned away because it could send no more
 * confirmation email (the 30-per-hour project cap, or Resend's 100 a day).
 *
 * WHY (2026-11-17 scale audit): Supabase rolls the whole signup back when the
 * email can't go out, so in a rush every signup past the 30th in an hour was
 * lost, and the form told those people to check their inbox. Here the account
 * is made anyway, through the admin API (which sends no email and is not
 * email-rate-limited), still UNCONFIRMED, so it cannot sign in yet. The address
 * goes into `signup_email_queue`, and scripts/send-queued-signup-links.mjs
 * mails the confirm link hourly through the cron email pool (Brevo first, a
 * separate quota from Supabase's Resend one).
 *
 * Nothing is weakened: the caller has already passed the honeypot, timing trap,
 * IP limit, breached-password check and (when on) Supabase's captcha, because
 * Supabase checks captcha before it ever tries to send.
 */
export type QueuedSignup =
  | { ok: true; userId: string | null }
  | { ok: false; error: string };

const ALREADY_EXISTS = /already (been )?registered|already exists|email_exists|user_already_exists/i;

export async function queueSignupAfterEmailCap(
  sr: SupabaseClient,
  input: { email: string; password: string },
): Promise<QueuedSignup> {
  const email = input.email.trim().toLowerCase();
  let userId: string | null = null;

  const { data, error } = await sr.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: false,
  });
  if (error) {
    // An earlier signup left this address unconfirmed. Keep that account and
    // its first password (Supabase never replaces it), and queue a fresh link.
    if (!ALREADY_EXISTS.test(`${error.code ?? ""} ${error.message}`)) {
      return { ok: false, error: error.message };
    }
  } else {
    userId = data.user?.id ?? null;
  }

  const { error: qErr } = await sr.from("signup_email_queue").upsert(
    { email, user_id: userId, status: "pending", attempts: 0, last_error: null, queued_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  // The account exists either way. If the queue write failed, the person can
  // still use "Resend the link" or "Forgot password" once the rush is over.
  if (qErr) console.error("[signup] queue write failed:", qErr.message);
  return { ok: true, userId };
}
