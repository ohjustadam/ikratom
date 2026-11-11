/**
 * Pure helpers for answering a feedback report (no I/O, so they are unit
 * tested directly). The server action in ./actions.ts does the writes.
 *
 * Who a reply can reach:
 *   - a signed-in reporter (user_id set): on the site, as a notification;
 *   - an anonymous reporter: by email, but only to an address THEY gave us,
 *     either the widget's email field or one typed into their own message.
 *     There is no free-form "to" box, so the tool can't mail anyone else.
 */

export const REPLY_MAX = 4000;
export const REPLY_TAG = "feedback_reply";
export const REPLY_KIND = "feedback_reply";

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const EMAIL_EXACT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Clean an address typed into the widget. "" → null; bad → "invalid". */
export function normalizeContactEmail(raw: string | null | undefined): string | null | "invalid" {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.length > 254 || !EMAIL_EXACT.test(v)) return "invalid";
  return v.toLowerCase();
}

/** The address an anonymous reporter gave: the widget field first, else the first one in their message. */
export function findReplyEmail(report: { contact_email?: string | null; message: string }): string | null {
  const field = normalizeContactEmail(report.contact_email);
  if (field && field !== "invalid") return field;
  const m = report.message.match(EMAIL_IN_TEXT);
  if (!m) return null;
  const found = normalizeContactEmail(m[0].replace(/[.\-]+$/, ""));
  return found && found !== "invalid" ? found : null;
}

export type ReplyRoute =
  | { channel: "site"; userId: string }
  | { channel: "email"; to: string }
  | { channel: null; why: string };

export function replyRoute(report: {
  user_id: string | null;
  contact_email?: string | null;
  message: string;
}): ReplyRoute {
  if (report.user_id) return { channel: "site", userId: report.user_id };
  const to = findReplyEmail(report);
  if (to) return { channel: "email", to };
  return { channel: null, why: "Sent without signing in and without an email address, so there is no way to reach them." };
}

/** Trim + cap the reply body. Returns the clean text or an error string. */
export function cleanReplyBody(raw: string | null | undefined): { body: string } | { error: string } {
  const body = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { error: "Write a reply first." };
  if (body.length > REPLY_MAX) return { error: `Reply is too long (${REPLY_MAX} character max).` };
  return { body };
}

function preview(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** The in-site notification a signed-in reporter gets. */
export function replyNotification(reportId: string, body: string) {
  return {
    kind: REPLY_KIND,
    title: "The iKratom team replied to your feedback",
    body: preview(body, 140),
    link: `/feedback#r-${reportId}`,
  };
}

/** The platform email an anonymous reporter gets. Plain text, from the team. */
export function replyEmail(input: { reportMessage: string; reportDate: string; body: string; siteUrl: string }) {
  const day = new Date(input.reportDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const quoted = preview(input.reportMessage, 300)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const text =
    `Hi,\n\nOn ${day} you sent iKratom this feedback:\n\n${quoted}\n\n` +
    `Here is our reply:\n\n${input.body}\n\n` +
    `You can answer by replying to this email.\n\n` +
    `The iKratom team\n${input.siteUrl}\n`;
  return { subject: "A reply to your iKratom feedback", text };
}

/** One short line for the thread: how the reply went out. */
export function deliveryLabel(r: { channel: string; status: string; detail: string | null }): string {
  const where = r.channel === "email" ? "Emailed" : "On the site";
  if (r.status === "sent") return r.detail ? `${where} · ${r.detail}` : where;
  if (r.status === "failed") return `${where} · not delivered${r.detail ? `: ${r.detail}` : ""}`;
  return `${where} · sending`;
}
