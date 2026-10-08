/**
 * owner-alert.mjs — reach the owner's PHONE for free, with no app-store app.
 *
 * Channels, each optional and independent (a failure in one never blocks
 * another, and none of them run through the site, so they work while it is down):
 *   ntfy   NTFY_TOPIC (+ NTFY_SERVER, default https://ntfy.sh). Free, open-source
 *          push app for Android/iOS: install "ntfy", subscribe to the topic. The
 *          topic name IS the secret — keep it long and random.
 *   email  OWNER_EMAIL through the shared email sender (Resend/Brevo quota).
 *   sms    OWNER_SMS_EMAIL — a carrier email-to-text address
 *          (e.g. 5551234567@vtext.com Verizon, @tmomail.net T-Mobile,
 *          @txt.att.net AT&T). Free, short, plain text.
 *
 * Existing web-push to the owner's PWA stays where it is; this adds the
 * channels that do not depend on having the PWA installed.
 */
import { sendEmail } from "./email-send.mjs";

const PRIORITY = { urgent: "urgent", high: "high", normal: "default", low: "low" };

/**
 * @param {{title:string, body:string, priority?:"urgent"|"high"|"normal"|"low", link?:string, tags?:string[], sb?:any}} a
 * @returns {Promise<{ntfy:string, email:string, sms:string}>}
 */
export async function alertOwner({ title, body, priority = "high", link, tags = [], sb = null }) {
  const out = { ntfy: "off", email: "off", sms: "off" };
  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    try {
      const r = await fetch(`${(process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "")}/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers: {
          // Header values must be ASCII; emoji and smart quotes go in Tags/body instead.
          Title: title.replace(/[^\x20-\x7E]/g, "").slice(0, 200),
          Priority: PRIORITY[priority] ?? "high",
          ...(tags.length ? { Tags: tags.join(",") } : {}),
          ...(link ? { Click: link } : {}),
        },
        body: body.slice(0, 3800),
        signal: AbortSignal.timeout(15_000),
      });
      out.ntfy = r.ok ? "sent" : `failed ${r.status}`;
    } catch (e) { out.ntfy = `failed ${e.message}`; }
  }
  if (sb && process.env.OWNER_EMAIL) {
    const r = await sendEmail(sb, { to: process.env.OWNER_EMAIL, subject: `[iKratom ops] ${title}`, text: `${body}${link ? `\n\n${link}` : ""}`, html: `<pre style="font:14px/1.5 monospace;white-space:pre-wrap">${escapeHtml(body)}${link ? `\n\n<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : ""}</pre>`, tag: "owner_alert" });
    out.email = r.ok ? "sent" : `failed ${r.error}`;
  }
  if (sb && process.env.OWNER_SMS_EMAIL) {
    // Carrier gateways cut long messages and ignore HTML: one short line.
    const r = await sendEmail(sb, { to: process.env.OWNER_SMS_EMAIL, subject: "iKratom", text: `${title}: ${body}`.slice(0, 150), html: undefined, tag: "owner_sms" });
    out.sms = r.ok ? "sent" : `failed ${r.error}`;
  }
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
