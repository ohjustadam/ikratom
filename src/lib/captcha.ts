/**
 * Cloudflare Turnstile tokens for Supabase Auth (2026-11-11 account hardening).
 *
 * Every sign-in, sign-up, resend and password-reset call to Supabase Auth
 * forwards the visitor's Turnstile token as `captchaToken`. Supabase verifies
 * it itself once the project's captcha setting is on, so the server actions
 * must NEVER verify the token here too: a Turnstile token is single-use, and
 * checking it first would make Supabase's check fail as a duplicate.
 *
 * With no token (the site key is unset, or the widget never loaded) the call
 * goes out without one. That is harmless while captcha is off in Supabase,
 * and Supabase rejects it once captcha is on, which is the point.
 *
 * Shared by the browser forms and the server actions, so no "use server" /
 * "use client" here.
 */

/** FormData field that carries the token from the form to the server action. */
export const CAPTCHA_FIELD = "captcha_token";

/** Turnstile tokens are at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;

/** The token a form sent, or undefined. Never throws. */
export function captchaTokenFrom(source: FormData | string | null | undefined): string | undefined {
  const raw = typeof source === "string" || source == null ? source : source.get(CAPTCHA_FIELD);
  if (typeof raw !== "string") return undefined;
  const token = raw.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return undefined;
  return token;
}

/** True when a Supabase Auth error is the captcha check failing. */
export function isCaptchaError(message: string | null | undefined): boolean {
  return !!message && /captcha/i.test(message);
}

export const CAPTCHA_FAILED_MESSAGE = "We couldn't confirm you're a person.";
export const CAPTCHA_FAILED_HINT =
  "Refresh the page and try again. If a privacy blocker is on, allow challenges.cloudflare.com for this site.";
