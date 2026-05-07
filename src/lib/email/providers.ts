/**
 * Email provider wrappers — one per service. Each exports a `send()` that
 * speaks the provider's HTTP API and returns a normalized result.
 *
 * Why thin wrappers vs a unified SDK: the providers all do roughly the
 * same thing but their APIs diverge in small ways (field names, auth
 * style, response shape). Keeping each as a self-contained ~30-line
 * function makes failure modes obvious and substitution trivial.
 *
 * Free-tier daily caps (as of 2026-05):
 *   - Resend     100/day   3,000/month
 *   - Brevo      300/day   9,000/month
 *   - Mailjet    200/day   6,000/month
 *   - MailerSend ~100/day  3,000/month
 *
 * Combined headroom: ~700/day if all four are wired. The router
 * (./router.ts) picks providers in order of remaining cap and falls
 * back on errors.
 */

import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

const TIMEOUT_MS = 10_000;

// ────────────────────────────────────────────────────────────────────
// Resend — already in production. https://resend.com/docs/api-reference
// ────────────────────────────────────────────────────────────────────
async function sendResend(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, provider: "resend", reason: "no_api_key" };
  const fromEmail = msg.fromEmail ?? process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) return { ok: false, provider: "resend", reason: "no_from_address" };
  const fromName = msg.fromName ?? process.env.RESEND_FROM_NAME ?? "iKratom";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [msg.to],
        subject: msg.subject.slice(0, 200),
        text: msg.text,
        html: msg.html,
        tags: msg.tag ? [{ name: "kind", value: msg.tag.slice(0, 30) }] : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, provider: "resend", reason: "api_error", error: `${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, provider: "resend", id: data.id ?? "(no id)" };
  } catch (e) {
    return { ok: false, provider: "resend", reason: "network", error: (e as Error).message };
  }
}

// ────────────────────────────────────────────────────────────────────
// Brevo (Sendinblue) — best free daily cap (300/day).
// https://developers.brevo.com/reference/sendtransacemail
// ────────────────────────────────────────────────────────────────────
async function sendBrevo(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, provider: "brevo", reason: "no_api_key" };
  const fromEmail = msg.fromEmail ?? process.env.BREVO_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) return { ok: false, provider: "brevo", reason: "no_from_address" };
  const fromName = msg.fromName ?? process.env.BREVO_FROM_NAME ?? process.env.RESEND_FROM_NAME ?? "iKratom";

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: msg.to }],
        subject: msg.subject.slice(0, 200),
        textContent: msg.text,
        htmlContent: msg.html,
        tags: msg.tag ? [msg.tag.slice(0, 30)] : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, provider: "brevo", reason: "api_error", error: `${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as { messageId?: string };
    return { ok: true, provider: "brevo", id: data.messageId ?? "(no id)" };
  } catch (e) {
    return { ok: false, provider: "brevo", reason: "network", error: (e as Error).message };
  }
}

// ────────────────────────────────────────────────────────────────────
// Mailjet — 200/day free.
// https://dev.mailjet.com/email/reference/send-emails/
// Auth: HTTP Basic with API_KEY:SECRET_KEY
// ────────────────────────────────────────────────────────────────────
async function sendMailjet(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  if (!apiKey || !apiSecret) return { ok: false, provider: "mailjet", reason: "no_api_key" };
  const fromEmail = msg.fromEmail ?? process.env.MAILJET_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) return { ok: false, provider: "mailjet", reason: "no_from_address" };
  const fromName = msg.fromName ?? process.env.MAILJET_FROM_NAME ?? process.env.RESEND_FROM_NAME ?? "iKratom";

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  try {
    const res = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        Messages: [{
          From: { Email: fromEmail, Name: fromName },
          To: [{ Email: msg.to }],
          Subject: msg.subject.slice(0, 200),
          TextPart: msg.text,
          HTMLPart: msg.html,
          CustomCampaign: msg.tag?.slice(0, 30),
        }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, provider: "mailjet", reason: "api_error", error: `${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as { Messages?: { To?: { MessageID?: string }[] }[] };
    const id = data.Messages?.[0]?.To?.[0]?.MessageID ?? "(no id)";
    return { ok: true, provider: "mailjet", id };
  } catch (e) {
    return { ok: false, provider: "mailjet", reason: "network", error: (e as Error).message };
  }
}

// ────────────────────────────────────────────────────────────────────
// MailerSend — ~100/day, ~3,000/month free.
// https://developers.mailersend.com/api/v1/email.html
// ────────────────────────────────────────────────────────────────────
async function sendMailerSend(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.MAILERSEND_API_KEY;
  if (!apiKey) return { ok: false, provider: "mailersend", reason: "no_api_key" };
  const fromEmail = msg.fromEmail ?? process.env.MAILERSEND_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) return { ok: false, provider: "mailersend", reason: "no_from_address" };
  const fromName = msg.fromName ?? process.env.MAILERSEND_FROM_NAME ?? process.env.RESEND_FROM_NAME ?? "iKratom";

  try {
    const res = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: msg.to }],
        subject: msg.subject.slice(0, 200),
        text: msg.text,
        html: msg.html,
        tags: msg.tag ? [msg.tag.slice(0, 30)] : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, provider: "mailersend", reason: "api_error", error: `${res.status}: ${body.slice(0, 300)}` };
    }
    // MailerSend returns 202 with X-Message-Id header on success
    const id = res.headers.get("X-Message-Id") ?? "(no id)";
    return { ok: true, provider: "mailersend", id };
  } catch (e) {
    return { ok: false, provider: "mailersend", reason: "network", error: (e as Error).message };
  }
}

export const emailProviders: Record<EmailProvider, (msg: EmailMessage) => Promise<EmailSendResult>> = {
  resend: sendResend,
  brevo: sendBrevo,
  mailjet: sendMailjet,
  mailersend: sendMailerSend,
};

export function isProviderConfigured(p: EmailProvider): boolean {
  switch (p) {
    case "resend": return !!process.env.RESEND_API_KEY;
    case "brevo": return !!process.env.BREVO_API_KEY;
    case "mailjet": return !!(process.env.MAILJET_API_KEY && process.env.MAILJET_API_SECRET);
    case "mailersend": return !!process.env.MAILERSEND_API_KEY;
  }
}

/** Daily free-tier cap per provider — used by the router for fallover. */
export const DAILY_CAP: Record<EmailProvider, number> = {
  resend: 100,
  brevo: 300,
  mailjet: 200,
  mailersend: 100,
};
