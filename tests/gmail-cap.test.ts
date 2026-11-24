import { describe, expect, it } from "vitest";
import { GMAIL_CONNECT_STOP_AT, GMAIL_UNVERIFIED_CAP, gmailConnectOpen } from "@/lib/email/gmail-cap";

describe("gmailConnectOpen", () => {
  const base = { verified: false, grantedBefore: false };

  it("stops offering Connect Gmail before Google's 100-person cap", () => {
    expect(GMAIL_CONNECT_STOP_AT).toBeLessThan(GMAIL_UNVERIFIED_CAP);
    expect(gmailConnectOpen({ ...base, grants: GMAIL_CONNECT_STOP_AT - 1 })).toBe(true);
    expect(gmailConnectOpen({ ...base, grants: GMAIL_CONNECT_STOP_AT })).toBe(false);
    expect(gmailConnectOpen({ ...base, grants: 150 })).toBe(false);
  });

  it("lets anyone who granted before reconnect: Google counts people, not grants", () => {
    expect(gmailConnectOpen({ ...base, grantedBefore: true, grants: 99 })).toBe(true);
  });

  it("is always open once Google has verified the app", () => {
    expect(gmailConnectOpen({ verified: true, grantedBefore: false, grants: 500 })).toBe(true);
  });

  it("keeps today's behaviour when the count can't be read", () => {
    expect(gmailConnectOpen({ ...base, grants: null })).toBe(true);
  });
});
