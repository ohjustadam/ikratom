/**
 * Officials' emails come only from the page, never from the model's guess.
 *
 * Found 2026-11-03: a member's letter to the mayor of Rensselaer, NY bounced
 * ("550 5.4.1 Recipient address rejected: Access denied", which is Microsoft's
 * answer for a mailbox that does not exist). The city's site masks addresses
 * with Cloudflare, the extractor saw "[email protected]", and the model wrote
 * jddefranco@ for john.defrancesco@rensselaerny.gov. Of 231 AI-extracted
 * addresses, 8 were wrong and 10 appeared nowhere on their source page.
 */
import { describe, it, expect } from "vitest";
import { decodeCfEmails } from "../scripts/lib/page-text.mjs";
import { emailOnPage } from "../scripts/lib/officials-extract.mjs";
import { isMailbox } from "../src/lib/mailbox";

// Real markup from rensselaerny.gov (2026-11-03).
const RENSSELAER = '<li><a href="http://johndefrancesco@rensselaerny.gov" target="_blank"><span class="__cf_email__" data-cfemail="a3c9cccbcd8dc7c6c5d1c2cdc0c6d0c0cce3d1c6cdd0d0c6cfc2c6d1cdda8dc4ccd5">[email&#160;protected]</span></a></li>';

describe("decodeCfEmails", () => {
  it("restores a Cloudflare-masked address", () => {
    expect(decodeCfEmails(RENSSELAER)).toContain("john.defrancesco@rensselaerny.gov");
    expect(decodeCfEmails(RENSSELAER)).not.toContain("[email");
  });

  it("restores the masked mailto link form", () => {
    const html = '<a href="/cdn-cgi/l/email-protection#a3c9cccbcd8dc7c6c5d1c2cdc0c6d0c0cce3d1c6cdd0d0c6cfc2c6d1cdda8dc4ccd5">Email</a>';
    expect(decodeCfEmails(html)).toContain("john.defrancesco@rensselaerny.gov");
  });

  it("keeps an address that sits only in a mailto href", () => {
    expect(decodeCfEmails('<a class="x" href="mailto:clerk@town.gov?subject=hi">Email the clerk</a>')).toContain("clerk@town.gov");
  });

  it("drops a payload that does not decode to an address", () => {
    expect(decodeCfEmails('<span data-cfemail="ff00">x</span>')).not.toMatch(/@/);
  });
});

describe("emailOnPage", () => {
  const page = decodeCfEmails(RENSSELAER);
  it("keeps an address the page shows, in any case", () => {
    expect(emailOnPage("John.DeFrancesco@rensselaerny.gov", page)).toBe("john.defrancesco@rensselaerny.gov");
  });
  it("rejects a guessed address", () => {
    expect(emailOnPage("jddefranco@rensselaerny.gov", page)).toBeNull();
  });
  it("rejects non-addresses", () => {
    expect(emailOnPage("", page)).toBeNull();
    expect(emailOnPage("not an email", page)).toBeNull();
    expect(emailOnPage(null, page)).toBeNull();
  });
});

// The send paths' gate. "hhttps://..." reached Gmail as a To header on
// 2026-11-03 because the old check was startsWith("http").
describe("isMailbox", () => {
  it("accepts a real address", () => {
    expect(isMailbox("john.defrancesco@rensselaerny.gov")).toBe(true);
    expect(isMailbox(" Clerk@Town.gov ")).toBe(true);
  });
  it("rejects contact forms, typos and link text", () => {
    expect(isMailbox("https://fine.house.gov/contact")).toBe(false);
    expect(isMailbox("hhttps://fine.house.gov/address_authentication?form=/contact/email-me")).toBe(false);
    expect(isMailbox("https://x.gov/a@b.gov")).toBe(false);
    expect(isMailbox("Email Jim Hamsher")).toBe(false);
    expect(isMailbox("")).toBe(false);
    expect(isMailbox(null)).toBe(false);
  });
});
