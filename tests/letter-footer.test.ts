import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The iKratom footer, HTML edition (owner, 2026-10-24: "our IK logo plus a
 * hyperlink, make it look nice, always on all emails"). These pin the footer
 * in both parts of the email and that every provider receives both.
 */

const sent = vi.hoisted(() => ({ calls: [] as Array<{ via: string; body: string; html?: string }> }));
vi.mock("../src/lib/email/gmail", () => ({
  sendViaGmail: vi.fn(async (i: { body: string; html?: string }) => { sent.calls.push({ via: "gmail", ...i }); return { messageId: "g" }; }),
  GmailTokenRevokedError: class extends Error {},
  markGmailIntegrationRevoked: vi.fn(),
}));
vi.mock("../src/lib/email/outlook", () => ({
  sendViaOutlook: vi.fn(async (i: { body: string; html?: string }) => { sent.calls.push({ via: "outlook", ...i }); return { messageId: "o" }; }),
  OutlookTokenRevokedError: class extends Error {},
  markOutlookIntegrationRevoked: vi.fn(),
}));
vi.mock("../src/lib/email/smtp", () => ({
  sendViaSmtp: vi.fn(async (i: { body: string; html?: string }) => { sent.calls.push({ via: "smtp", ...i }); return { messageId: "s" }; }),
  SmtpAuthError: class extends Error {},
  isSmtpProvider: (p: string) => ["yahoo", "aol", "icloud"].includes(p),
}));

import { FOOTER_HTML, LETTER_FOOTER, LOGO_URL, SITE_URL, letterHtml, letterParts, withLetterFooter } from "../src/lib/email/letter-footer";
import { sendOnUserBehalf, type EmailIntegrationRow } from "../src/lib/email/user-send";

const CLIP = "https://abc.supabase.co/storage/v1/object/public/campaign-attachments/u1/c1.m4a";
const letter = `Dear Representative Pless,\n\nKratom helps me <work> & "rest".\n\nListen to my 30-second message: ${CLIP}\n\nSincerely,\nPaul E.\nGulfport, MS`;

describe("the plain footer", () => {
  it("reads 'Sent via iKratom — https://www.ikratom.org' after the sender's name", () => {
    expect(LETTER_FOOTER).toBe("Sent via iKratom — https://www.ikratom.org");
    expect(withLetterFooter(letter).endsWith(`Gulfport, MS\n\n${LETTER_FOOTER}`)).toBe(true);
  });

  it("is never doubled", () => {
    const once = withLetterFooter(letter);
    expect(withLetterFooter(once)).toBe(once);
    expect(letterParts(once).text).toBe(once);
  });
});

describe("the HTML part", () => {
  const html = letterHtml(letter);

  it("ends with the iK logo (absolute https PNG, alt text) and the link", () => {
    expect(html.endsWith(`${FOOTER_HTML}</div></body></html>`)).toBe(true);
    expect(LOGO_URL).toBe("https://www.ikratom.org/ikratom-icon-180.png");
    expect(FOOTER_HTML).toContain(`<img src="${LOGO_URL}" width="22" height="22" alt="iKratom"`);
    expect(FOOTER_HTML).toContain(`<a href="${SITE_URL}" style="color:#059669;text-decoration:none;">Sent via iKratom</a>`);
  });

  it("is neutral: no tracking, no SVG, no stylesheet", () => {
    for (const url of html.match(/(?:href|src)="([^"]+)"/g) ?? []) expect(url).not.toMatch(/[?&](utm_|ref=|fbclid|gclid)/);
    expect(html).not.toMatch(/\.svg|<style|<script|class=/);
  });

  it("keeps the letter's own words, escaped, with clickable links", () => {
    expect(html).toContain("Kratom helps me &lt;work&gt; &amp; &quot;rest&quot;.");
    expect(html).toContain(`<a href="${CLIP}">${CLIP}</a>`);
    expect(html).toContain("Sincerely,<br>Paul E.<br>Gulfport, MS");
    expect(html).not.toContain(LETTER_FOOTER); // the plain line becomes the logo footer
  });

  it("leaves the letter's colours to the mail client (light and dark)", () => {
    const beforeFooter = html.slice(0, html.indexOf(FOOTER_HTML));
    expect(beforeFooter).not.toMatch(/(?<!-)color:/);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });
});

describe("every provider gets text + HTML, each with the footer", () => {
  beforeEach(() => { sent.calls.length = 0; });
  const row = (provider: EmailIntegrationRow["provider"]): EmailIntegrationRow =>
    ({ user_id: "u", provider, account_email: "paul@example.com", refresh_token: "t" });

  it.each(["gmail", "outlook", "yahoo", "aol", "icloud"] as const)("%s", async (provider) => {
    await sendOnUserBehalf({ integration: row(provider), fromName: "Paul E.", to: "rep@ncleg.gov", subject: "Kratom", body: letter });
    const [call] = sent.calls;
    expect(call.body.endsWith(`\n\n${LETTER_FOOTER}`)).toBe(true);
    expect(call.html).toContain(FOOTER_HTML);
    expect(call.html).toContain(CLIP);
  });

  it("a caller that already added the plain footer doesn't get two", async () => {
    await sendOnUserBehalf({ integration: row("gmail"), fromName: null, to: "rep@ncleg.gov", subject: "K", body: withLetterFooter(letter) });
    expect(sent.calls[0].body.split(LETTER_FOOTER)).toHaveLength(2);
  });
});
