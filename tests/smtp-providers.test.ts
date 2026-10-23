import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveLimits, tiersForProvider } from "../src/lib/email/provider-limits";

/**
 * Yahoo, AOL and iCloud one-click sending with an encrypted app password
 * (owner yes 2026-10-22). Pins the 300/day cap, the encryption and the
 * check-before-store order.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const smtp = read("src/lib/email/smtp.ts");
const actions = read("src/modules/auth/actions-smtp.ts");
const dispatch = read("src/lib/email/user-send.ts");

describe("limits", () => {
  it("caps every app-password provider at 300 a day, 20 a minute", () => {
    for (const p of ["yahoo", "aol", "icloud"] as const) {
      const l = resolveLimits(p, `someone@example.com`);
      expect(l.effectiveDaily, p).toBe(300);
      expect(l.maxPerMinute, p).toBe(20);
    }
  });

  it("leaves Gmail and Outlook as they were", () => {
    expect(resolveLimits("gmail", "a@gmail.com").effectiveDaily).toBe(425);
    expect(resolveLimits("outlook", "a@outlook.com").effectiveDaily).toBe(255);
    expect(tiersForProvider("icloud")).toHaveLength(1);
  });
});

describe("connecting", () => {
  it("checks the app password with the provider before storing it, encrypted", () => {
    const verify = actions.indexOf("await verifySmtpLogin(");
    const store = actions.indexOf('from("email_integrations").upsert(');
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(store);
    expect(actions).toMatch(/refresh_token: encryptToken\(appPassword\)/);
  });

  it("only accepts that provider's own addresses, and is rate-limited", () => {
    expect(actions).toMatch(/cfg\.domains\.includes\(email\.split\("@"\)\[1\]\)/);
    expect(actions).toMatch(/checkRateLimit\(`smtp:connect:\$\{user\.id\}`, 5, 3600\)/);
  });

  it("never hands the password back, and disconnect deletes it", () => {
    expect(actions).not.toMatch(/return \{[^}]*appPassword/);
    expect(actions).toMatch(/\.delete\(\)\.eq\("user_id", user\.id\)/);
  });
});

describe("sending", () => {
  it("uses TLS to each provider's documented server", () => {
    expect(smtp).toMatch(/host: "smtp\.mail\.yahoo\.com", port: 465, secure: true/);
    expect(smtp).toMatch(/host: "smtp\.aol\.com", port: 465, secure: true/);
    expect(smtp).toMatch(/host: "smtp\.mail\.me\.com", port: 587, secure: false/);
    expect(smtp).toMatch(/requireTLS: !cfg\.secure/);
  });

  it("goes through the same dispatcher, and a rejected password asks the member to reconnect", () => {
    expect(dispatch).toMatch(/if \(p === "yahoo" \|\| p === "aol" \|\| p === "icloud"\)/);
    expect(dispatch).toMatch(/if \(e instanceof SmtpAuthError\) throw new EmailTokenRevokedError\(e\.provider\)/);
  });
});
