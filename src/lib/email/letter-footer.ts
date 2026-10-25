/**
 * The iKratom footer on every letter a member sends to an official, and the
 * HTML version of the letter that carries it (owner, 2026-10-24: "our IK logo
 * plus a hyperlink, make it look nice, always on all emails").
 *
 *   - text/plain, mailto: and web compose end with one plain line,
 *     "Sent via iKratom — https://www.ikratom.org" (clients auto-link it);
 *   - the HTML part ends with the iK mark (22 px, an absolute https PNG: Gmail
 *     blocks SVG) and "Sent via iKratom" linking to the site.
 * Neutral on purpose: no tracking parameters, no promotion. Inline styles
 * only, and no text colour on the letter itself, so light and dark mail
 * clients each render it in their own colours.
 *
 * Pure (no server imports): the composer uses it in the browser too.
 */

export const SITE_URL = "https://www.ikratom.org";
/** Already served from public/ (2.2 KB, green iK on black: legible on light and dark). */
export const LOGO_URL = `${SITE_URL}/ikratom-icon-180.png`;
export const LETTER_FOOTER = `Sent via iKratom — ${SITE_URL}`;

const trimEnd = (s: string) => String(s ?? "").replace(/\s+$/, "");

/** The letter without a trailing footer line, so it is never added twice. */
export function stripLetterFooter(body: string): string {
  const text = trimEnd(body);
  return text.endsWith(LETTER_FOOTER) ? trimEnd(text.slice(0, -LETTER_FOOTER.length)) : text;
}

/** Close a rendered letter with the plain footer, after the sender's name. Idempotent. */
export function withLetterFooter(body: string): string {
  const text = stripLetterFooter(body);
  return text ? `${text}\n\n${LETTER_FOOTER}` : LETTER_FOOTER;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const URL_RE = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

/** Make bare http(s) links clickable (the clip link, a bill page); escape everything. */
function lineHtml(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    const url = escapeHtml(m[0]);
    out += `${escapeHtml(line.slice(last, m.index))}<a href="${url}">${url}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(line.slice(last));
}

export const FOOTER_HTML =
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;border-collapse:collapse;">` +
  `<tr>` +
  `<td style="padding:0 8px 0 0;vertical-align:middle;">` +
  `<a href="${SITE_URL}" style="text-decoration:none;">` +
  `<img src="${LOGO_URL}" width="22" height="22" alt="iKratom" style="display:block;width:22px;height:22px;border:0;border-radius:5px;">` +
  `</a></td>` +
  `<td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:22px;">` +
  `<a href="${SITE_URL}" style="color:#059669;text-decoration:none;">Sent via iKratom</a>` +
  `</td></tr></table>`;

/** The letter as simple HTML: paragraphs on blank lines, <br> on single ones, then the footer. */
export function letterHtml(body: string): string {
  const paragraphs = stripLetterFooter(body)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim() !== "")
    .map((p) => `<p style="margin:0 0 1em 0;">${p.split("\n").map(lineHtml).join("<br>")}</p>`)
    .join("");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">` +
    `<meta name="supported-color-schemes" content="light dark"></head>` +
    `<body style="margin:0;padding:0;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">` +
    `${paragraphs}${FOOTER_HTML}</div></body></html>`
  );
}

/** Both parts of the email for one official: text/plain and text/html, each with its footer. */
export function letterParts(body: string): { text: string; html: string } {
  return { text: withLetterFooter(body), html: letterHtml(body) };
}
