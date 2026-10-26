import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** "Send a test letter to myself" (2026-10-25): it can only ever mail the member's own connected address. */
const action = readFileSync(new URL("../src/modules/auth/actions-test-letter.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/account/page.tsx", import.meta.url), "utf8");

describe("test letter", () => {
  it("takes no arguments and sends only to the connected mailbox", () => {
    expect(action).toMatch(/export async function sendTestLetterToMe\(\)/);
    expect(action).toMatch(/to: integration\.account_email/);
    expect(action.match(/sendOnUserBehalf\(/g)).toHaveLength(1);
  });

  it("is rate-limited and goes through the footer-adding sender", () => {
    expect(action).toMatch(/checkRateLimit\(`test-letter:user:\$\{user\.id\}`, 3, 3600\)/);
    expect(action).toMatch(/from "@\/lib\/email\/user-send"/);
  });

  it("shows on /account only when an email is connected", () => {
    expect(page).toMatch(/\{anyIntegration && \(\s*<div[^>]*>\s*<h3[^>]*>Test letter<\/h3>\s*<TestLetterButton email=\{anyIntegration\.account_email\}/);
  });
});
