import { describe, expect, it } from "vitest";
import { detectModerationSignals, moderateNewContent } from "../moderation";

describe("detectModerationSignals", () => {
  it("returns all-empty for empty/null input", () => {
    const s = detectModerationSignals("");
    expect(s.urls).toEqual([]);
    expect(s.bareDomains).toEqual([]);
    expect(s.phones).toEqual([]);
    expect(s.emails).toEqual([]);
    expect(s.cryptoWallets).toEqual([]);
  });

  it("detects non-whitelisted full URLs", () => {
    const s = detectModerationSignals("Check out https://buykratom.shop/now");
    expect(s.urls.length).toBe(1);
    expect(s.urls[0]).toContain("buykratom.shop");
  });

  it("ignores whitelisted full URLs", () => {
    const s = detectModerationSignals("Source: https://www.congress.gov/bill/118");
    expect(s.urls).toEqual([]);
  });

  it("ignores .gov + .edu URLs (whitelisted by suffix)", () => {
    const s = detectModerationSignals(
      "From https://oklahoma.gov/health and https://research.harvard.edu/paper",
    );
    expect(s.urls).toEqual([]);
  });

  it("ignores ikratom.org links", () => {
    const s = detectModerationSignals("See https://www.ikratom.org/banned for details");
    expect(s.urls).toEqual([]);
  });

  it("detects bare domains with real TLDs", () => {
    const s = detectModerationSignals("Visit buykratom.shop today");
    expect(s.bareDomains.length).toBe(1);
  });

  it("ignores bare domains with fake TLDs", () => {
    const s = detectModerationSignals("I.am.unsure about this");
    expect(s.bareDomains).toEqual([]);
  });

  it("ignores numeric-only labels like '1.2.3.4'", () => {
    const s = detectModerationSignals("Version 1.2.3.4 was released");
    expect(s.bareDomains).toEqual([]);
  });

  it("detects US phone numbers in various formats", () => {
    const s1 = detectModerationSignals("Call me at 555-867-5309");
    expect(s1.phones.length).toBe(1);

    const s2 = detectModerationSignals("Phone: (555) 867-5309");
    expect(s2.phones.length).toBe(1);

    const s3 = detectModerationSignals("Direct line +1-555-867-5309");
    expect(s3.phones.length).toBe(1);
  });

  it("does NOT match phone numbers starting with 0 or 1 (invalid)", () => {
    // Area code must start with 2-9 per NANP
    const s = detectModerationSignals("Call 155-867-5309");
    expect(s.phones.length).toBe(0);
  });

  it("detects email addresses", () => {
    const s = detectModerationSignals("Email me: spammer@example.com");
    expect(s.emails.length).toBe(1);
    expect(s.emails[0]).toBe("spammer@example.com");
  });

  it("doesn't treat the email-host as a bare domain", () => {
    const s = detectModerationSignals("Email spammer@spammy.shop");
    expect(s.emails.length).toBe(1);
    expect(s.bareDomains).toEqual([]); // spammy.shop should NOT also flag as bare
  });

  it("detects BTC wallet addresses", () => {
    const s = detectModerationSignals("Send to bc1q9d4ywgfnd8h43da5tpcxcn6ajv590cg6d3tg6axy");
    expect(s.cryptoWallets.length).toBe(1);
  });

  it("detects ETH wallet addresses", () => {
    const s = detectModerationSignals("Tip me at 0x742d35Cc6634C0532925a3b8D6dC2eF12fAEE7D8");
    expect(s.cryptoWallets.length).toBe(1);
  });

  it("dedupes repeated signals", () => {
    const s = detectModerationSignals(
      "buykratom.shop and again buykratom.shop and buykratom.shop",
    );
    expect(s.bareDomains.length).toBe(1);
  });

  it("handles mixed signal types in one post", () => {
    const s = detectModerationSignals(
      "Email spammer@evil.shop or call 555-867-5309 or visit https://spam.shop",
    );
    expect(s.emails.length).toBe(1);
    expect(s.phones.length).toBe(1);
    expect(s.urls.length).toBe(1);
  });
});

describe("moderateNewContent", () => {
  it("approves any content from privileged users (admin/owner)", () => {
    const out = moderateNewContent({
      body: "Visit https://obviousspam.com or call 555-867-5309",
      authorPostCount: 0,
      isPrivileged: true,
    });
    expect(out.status).toBe("approved");
    expect(out.signals).toBe(null);
  });

  it("auto-flags non-privileged content with URLs", () => {
    const out = moderateNewContent({
      body: "Check buykratom.shop",
      authorPostCount: 10,
      isPrivileged: false,
    });
    expect(out.status).toBe("auto_flagged");
    expect(out.signals).not.toBe(null);
    expect(out.reason).toContain("bare domain");
  });

  it("auto-flags content with phone numbers", () => {
    const out = moderateNewContent({
      body: "Call me at 555-867-5309",
      authorPostCount: 100,
      isPrivileged: false,
    });
    expect(out.status).toBe("auto_flagged");
    expect(out.reason).toContain("phone");
  });

  it("auto-flags content with crypto wallets", () => {
    const out = moderateNewContent({
      body: "Send BTC to bc1q9d4ywgfnd8h43da5tpcxcn6ajv590cg6d3tg6axy",
      authorPostCount: 100,
      isPrivileged: false,
    });
    expect(out.status).toBe("auto_flagged");
    expect(out.reason).toContain("wallet");
  });

  it("puts new accounts (< 3 posts) into pending", () => {
    const out = moderateNewContent({
      body: "First post, just clean text.",
      authorPostCount: 0,
      isPrivileged: false,
    });
    expect(out.status).toBe("pending");
    expect(out.reason).toContain("New account");
  });

  it("puts 2-post accounts into pending", () => {
    const out = moderateNewContent({
      body: "Clean text",
      authorPostCount: 2,
      isPrivileged: false,
    });
    expect(out.status).toBe("pending");
  });

  it("approves established accounts (>= 3 posts) with clean text", () => {
    const out = moderateNewContent({
      body: "Just a normal post about advocacy work in Oklahoma.",
      authorPostCount: 10,
      isPrivileged: false,
    });
    expect(out.status).toBe("approved");
  });

  it("approves established accounts linking to whitelisted sources", () => {
    const out = moderateNewContent({
      body: "Source: https://www.congress.gov/bill/118",
      authorPostCount: 10,
      isPrivileged: false,
    });
    expect(out.status).toBe("approved");
  });
});
