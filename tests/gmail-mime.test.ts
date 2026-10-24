import { describe, it, expect } from "vitest";
import { buildRfc2822 } from "../src/lib/email/gmail";
import { FOOTER_HTML, LETTER_FOOTER, letterParts } from "../src/lib/email/letter-footer";

/** One-click Gmail sends multipart/alternative: the plain letter and the HTML one, both with the footer. */

const decodePart = (raw: string, type: string) => {
  const start = raw.indexOf(`Content-Type: ${type}`);
  const body = raw.slice(raw.indexOf("\r\n\r\n", start) + 4, raw.indexOf("\r\n--", start));
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf-8");
};

describe("Gmail MIME", () => {
  const { text, html } = letterParts("Dear Senator Smith,\n\nThank you — truly.\n\nPaul E.");
  const raw = buildRfc2822({ fromName: "Paul E.", fromEmail: "p@gmail.com", to: "s@x.gov", subject: "Kratom", body: text, html, boundary: "B" });

  it("is multipart/alternative, text first, HTML last", () => {
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="B"');
    expect(raw.indexOf('Content-Type: text/plain')).toBeLessThan(raw.indexOf('Content-Type: text/html'));
    expect(raw.trimEnd().endsWith("--B--")).toBe(true);
  });

  it("each part decodes to the letter with its footer, dashes intact", () => {
    const plain = decodePart(raw, "text/plain");
    expect(plain).toBe(`Dear Senator Smith,\n\nThank you — truly.\n\nPaul E.\n\n${LETTER_FOOTER}`);
    expect(decodePart(raw, "text/html")).toContain(FOOTER_HTML);
  });

  it("base64 lines stay within 76 columns", () => {
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    const b64 = raw.split("\r\n").filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l));
    expect(b64.length).toBeGreaterThan(1);
    for (const line of b64) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("without HTML it is still a single text/plain part", () => {
    const one = buildRfc2822({ fromName: null, fromEmail: "p@gmail.com", to: "s@x.gov", subject: "K", body: "Hi" });
    expect(one).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(one).not.toContain("multipart");
  });
});
