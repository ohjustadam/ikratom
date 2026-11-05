import { describe, it, expect } from "vitest";
import { maskEmail, maskIp, redactPii } from "@/lib/redact";

describe("redact (0310: members' emails and IPs are the owner's alone)", () => {
  it("masks an email down to its first letter and domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j•••@gmail.com");
    expect(maskEmail("@x.com")).toBe("•••");
    expect(maskEmail(null)).toBeNull();
  });

  it("keeps only the network half of an IP", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.x.x");
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8::x");
    expect(maskIp(undefined)).toBeNull();
  });

  it("scrubs emails and IPs out of free text bound for a public GitHub issue", () => {
    const out = redactPii("login failed for jane@example.org from 198.51.100.7 and 2001:db8:0:1::5");
    expect(out).not.toMatch(/jane|example\.org|\.100\.7|2001:db8:0:1/);
    expect(out).toContain("[email]");
    expect(out).toContain("198.51.x.x");
    expect(out).toContain("[ip]");
    expect(redactPii(null)).toBe("");
  });
});
