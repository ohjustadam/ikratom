/**
 * Transactional email — system-sent messages from a platform sender.
 *
 * Currently a thin wrapper around Resend (https://resend.com — generous
 * free tier: 3000 emails/month, 100/day; no card required).
 *
 * No-op when `RESEND_API_KEY` is not set in env, so this module is safe
 * to import and call from anywhere even before the API key is wired up.
 * In that mode it returns `{ skipped: true }` so call sites can still
 * branch on success.
 *
 * Use cases that flow through here:
 *   - new-device sign-in alert ("New Chrome on Windows signed in to your account")
 *   - wave fire reminder (1 hour before fire)
 *   - wave-fire summary ("Your email went out — 47 of 50 sent")
 *   - admin-action notifications for owner (large role changes, etc.)
 *
 * NOT used for:
 *   - campaign emails (those come from each user's own Gmail OAuth — see
 *     src/lib/email/gmail.ts)
 *   - Supabase auth emails (signup confirmation, password reset — those
 *     are sent by Supabase Auth itself via its own SMTP)
 *
 * Setup checklist (do these once when domain is live):
 *   1. Sign up at https://resend.com
 *   2. Add domain (e.g. ikratom.org). Add the DNS records they show.
 *   3. Wait ~10 min for DNS to verify in their console.
 *   4. Create API key. Set Vercel env vars:
 *        RESEND_API_KEY=re_xxx
 *        RESEND_FROM_EMAIL=alerts@ikratom.org
 *        RESEND_FROM_NAME=iKratom
 *   5. Redeploy. This module starts sending immediately.
 */

const API = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string;
  subject: string;
  /** Plain-text body. Always required (some recipients prefer text). */
  text: string;
  /** Optional HTML body. If absent, Resend renders the text as plain. */
  html?: string;
  /** Override the default from name/email if needed. */
  fromName?: string;
  fromEmail?: string;
  /** Tag for analytics in Resend dashboard. */
  tag?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string }
  | { skipped: true; reason: "no_api_key" | "no_from_address" | "invalid_to" };

/**
 * Best-effort transactional send. Never throws — returns a discriminated
 * result so call sites can log without try/catch.
 */
export async function sendTransactionalEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[email] skipped (no RESEND_API_KEY): to=${input.to} subject=${input.subject.slice(0, 60)}`,
      );
    }
    return { skipped: true, reason: "no_api_key" };
  }

  const fromName = input.fromName ?? process.env.RESEND_FROM_NAME ?? "iKratom";
  const fromEmail = input.fromEmail ?? process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) return { skipped: true, reason: "no_from_address" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) {
    return { skipped: true, reason: "invalid_to" };
  }

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [input.to],
        subject: input.subject.slice(0, 200),
        text: input.text,
        html: input.html,
        tags: input.tag ? [{ name: "kind", value: input.tag.slice(0, 30) }] : undefined,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        error: `Resend ${res.status}: ${errBody.slice(0, 300)}`,
      };
    }
    const data = await res.json();
    return { ok: true, id: (data as { id?: string })?.id ?? "(no id)" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Helper: render a minimal branded HTML wrapper around a body string.
 * Inline styles only (email clients vary in CSS support). No images, no
 * tracking pixels.
 */
export function brandedHtml(input: { headline: string; body: string; ctaLabel?: string; ctaHref?: string }): string {
  const cta =
    input.ctaLabel && input.ctaHref
      ? `<p style="margin: 32px 0;">
           <a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;padding:12px 24px;background:#10b981;color:#0a0a0a;text-decoration:none;font-weight:700;border-radius:6px;">${escapeHtml(input.ctaLabel)}</a>
         </p>`
      : "";
  return `<!doctype html>
<html><body style="margin:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#e4e4e7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#0a0a0a;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #27272a;">
          <span style="color:#10b981;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;font-size:12px;">iKratom</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0;font-size:24px;line-height:1.2;color:#fff;">${escapeHtml(input.headline)}</h1>
          <div style="margin-top:16px;font-size:14px;line-height:1.5;color:#d4d4d8;">${input.body}</div>
          ${cta}
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #27272a;font-size:11px;color:#71717a;">
          You are receiving this because of activity on your iKratom account.
          Manage notifications at <a href="https://ikratom.org/account" style="color:#10b981;">/account</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
