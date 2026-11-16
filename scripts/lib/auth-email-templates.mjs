/**
 * The Supabase Auth email templates iKratom ships, as data.
 *
 * WHY: Supabase's default templates link to {{ .ConfirmationURL }}, its own
 * /auth/v1/verify, which (in the PKCE flow @supabase/ssr uses) hands back a
 * ?code= that only the browser that asked for the email can redeem. A member
 * who signs up on a phone browser and opens the email in the Yahoo Mail app
 * can never be signed in by it, and with no redirect set the link also dropped
 * people on the homepage, signed out, with no message (member report
 * 2026-11-09). These templates send a token_hash to /auth/confirm, which calls
 * verifyOtp() server-side and works in any browser or mail app. This is the
 * pattern Supabase documents for server-side auth in Next.js.
 *
 * Templates are only editable with custom SMTP; auth mail has gone through
 * Resend since October 2026. Apply or check with scripts/auth-email-templates.mjs.
 */

const button = (href, label) =>
  `<p style="margin:28px 0"><a href="${href}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">${label}</a></p>`;

const fallback = (href) =>
  `<p style="color:#666;font-size:12px">If the button doesn't work, copy this address into your browser:<br>${href}</p>`;

export const CONFIRM_LINK = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email";
export const RECOVERY_LINK =
  "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password";
export const MAGIC_LINK = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email";

/** Management API field → value we want live. */
export const DESIRED = {
  mailer_subjects_confirmation: "Confirm your iKratom account",
  mailer_templates_confirmation_content: [
    "<h2>Confirm your email</h2>",
    "<p>Thanks for joining iKratom. Tap the button to confirm your address. It signs you in and takes you to set up your account.</p>",
    button(CONFIRM_LINK, "Confirm my email"),
    "<p>The link works once and expires in an hour. Asked more than once? Use the newest email: each one replaces the one before.</p>",
    fallback(CONFIRM_LINK),
    `<p style="color:#666;font-size:12px">Didn't sign up? Ignore this email and nothing happens.</p>`,
  ].join("\n"),

  mailer_subjects_recovery: "Reset your iKratom password",
  mailer_templates_recovery_content: [
    "<h2>Reset your password</h2>",
    "<p>Tap the button to choose a new password for your iKratom account.</p>",
    button(RECOVERY_LINK, "Choose a new password"),
    "<p>The link works once and expires in an hour.</p>",
    fallback(RECOVERY_LINK),
    `<p style="color:#666;font-size:12px">Didn't ask for this? Ignore this email and your password stays the same.</p>`,
  ].join("\n"),

  mailer_subjects_magic_link: "Your iKratom sign-in link",
  mailer_templates_magic_link_content: [
    "<h2>Your sign-in link</h2>",
    "<p>Tap the button to sign in to iKratom. The link works once and expires shortly.</p>",
    button(MAGIC_LINK, "Sign in"),
    fallback(MAGIC_LINK),
  ].join("\n"),
};

/** Supabase's defaults as read from the project on 2026-11-10, for --rollback. */
export const SUPABASE_DEFAULTS = {
  mailer_subjects_confirmation: "Confirm your email address",
  mailer_templates_confirmation_content:
    '<h2>Confirm your email address</h2>\n\n<p>Follow the link below to confirm this email address and finish signing up.</p>\n<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>\n',
  mailer_subjects_recovery: "Reset your password",
  mailer_templates_recovery_content:
    '<h2>Reset your password</h2>\n\n<p>We received a request to reset your password. Follow the link below to choose a new one.</p>\n<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>\n<p>If you didn\'t request this, you can safely ignore this email.</p>\n',
  mailer_subjects_magic_link: "Your sign-in link",
  mailer_templates_magic_link_content:
    '<h2>Your sign-in link</h2>\n\n<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>\n<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>\n',
};

/** Fields whose live value differs from `want`. Whitespace-insensitive. */
export function templateDrift(live, want = DESIRED) {
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  return Object.keys(want).filter((k) => norm(live?.[k]) !== norm(want[k]));
}
