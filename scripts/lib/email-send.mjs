/**
 * email-send.mjs — the cron-side twin of src/lib/email/router.ts.
 *
 * WHY A TWIN: every GitHub Actions job runs plain Node against Supabase and
 * never touches Netlify. Email must keep working while the site is disabled
 * (2026-10-02: push stopped for days because delivery ran inside a Netlify
 * function). The TS router cannot be imported from .mjs, so this file mirrors
 * its provider order and caps. Keep the caps in sync with src/lib/email/providers.ts.
 *
 * Quota: per-provider daily counts live in `email_quota_log` (provider, day),
 * the same table the TS router writes, so both sides share one budget.
 * RESERVE is held back on every provider for auth + transactional mail.
 */
import crypto from "node:crypto";

const PROVIDERS = [
  // Largest free daily cap first, so the smaller ones last the whole day.
  { id: "brevo", envKey: "BREVO_API_KEY", dailyCap: 300, reserve: 10, send: sendBrevo },
  // Resend also carries Supabase Auth SMTP (sign-up confirmations, password
  // resets) and the site security notices, and those sends never reach
  // email_quota_log. Holding 40 back keeps account emails working on a day when
  // notifications run long (2026-10-06 the digest + launch email used 90 of 100).
  { id: "resend", envKey: "RESEND_API_KEY", dailyCap: 100, reserve: 40, send: sendResend },
];
export const RESERVE = 10; // default for a provider without its own reserve

const today = () => new Date().toISOString().slice(0, 10);
const configured = () => PROVIDERS.filter((p) => process.env[p.envKey]);
const fromAddress = () => ({
  email: process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL,
  name: process.env.EMAIL_FROM_NAME || process.env.RESEND_FROM_NAME || "iKratom",
});

async function usedToday(sb, provider) {
  const { data } = await sb.from("email_quota_log").select("sent_count").eq("provider", provider).eq("day", today()).maybeSingle();
  return data?.sent_count ?? 0;
}

async function bump(sb, provider, ok) {
  const day = today();
  const { data } = await sb.from("email_quota_log").select("sent_count, failed_count").eq("provider", provider).eq("day", day).maybeSingle();
  const row = { provider, day, sent_count: (data?.sent_count ?? 0) + (ok ? 1 : 0), failed_count: (data?.failed_count ?? 0) + (ok ? 0 : 1), last_send_at: new Date().toISOString() };
  if (data) await sb.from("email_quota_log").update(row).eq("provider", provider).eq("day", day);
  else await sb.from("email_quota_log").insert(row);
}

/** Emails still sendable today across every configured provider, after the reserve. */
export async function remainingToday(sb) {
  let left = 0;
  for (const p of configured()) left += Math.max(0, p.dailyCap - (p.reserve ?? RESERVE) - (await usedToday(sb, p.id)));
  return left;
}

export function providerSummary() {
  return configured().map((p) => `${p.id}(${p.dailyCap}/day)`).join(", ") || "NONE (set RESEND_API_KEY or BREVO_API_KEY)";
}

/**
 * Send one message. Tries providers in order, skipping any at its daily cap.
 * msg: { to, subject, html, text, unsubscribeUrl?, tag? }
 * Returns { ok: true, provider, id } or { ok: false, error }.
 */
export async function sendEmail(sb, msg) {
  if (!fromAddress().email) return { ok: false, error: "no sender address (RESEND_FROM_EMAIL / EMAIL_FROM)" };
  const errors = [];
  for (const p of configured()) {
    if ((await usedToday(sb, p.id)) >= p.dailyCap - (p.reserve ?? RESERVE)) { errors.push(`${p.id}: daily cap`); continue; }
    try {
      const id = await p.send(msg);
      await bump(sb, p.id, true);
      return { ok: true, provider: p.id, id };
    } catch (e) {
      await bump(sb, p.id, false);
      errors.push(`${p.id}: ${e.message}`);
    }
  }
  return { ok: false, error: errors.join(" | ") || "no provider configured" };
}

function listUnsubHeaders(url) {
  return url ? { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};
}

async function sendResend(msg) {
  const from = fromAddress();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
      headers: listUnsubHeaders(msg.unsubscribeUrl), tags: msg.tag ? [{ name: "kind", value: msg.tag }] : undefined,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 120)}`);
  return JSON.parse(body).id;
}

async function sendBrevo(msg) {
  const from = fromAddress();
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from.email, name: from.name }, to: [{ email: msg.to }], subject: msg.subject,
      htmlContent: msg.html, textContent: msg.text, headers: listUnsubHeaders(msg.unsubscribeUrl), tags: msg.tag ? [msg.tag] : undefined,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 120)}`);
  return JSON.parse(body).messageId;
}

/**
 * One-click unsubscribe token. Keyed off CRON_SECRET so no new secret has to
 * be provisioned: the same value already exists in GitHub Actions, Netlify and
 * .env.local. The site route `/api/email/unsubscribe` recomputes it.
 * Mirror: src/lib/email/unsubscribe.ts — keep the two identical.
 */
export function unsubscribeToken(userId) {
  const key = crypto.createHmac("sha256", process.env.CRON_SECRET || "").update("email-unsubscribe-v1").digest();
  return crypto.createHmac("sha256", key).update(userId).digest("base64url").slice(0, 32);
}

export function unsubscribeUrl(appUrl, userId) {
  return `${appUrl}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`;
}
