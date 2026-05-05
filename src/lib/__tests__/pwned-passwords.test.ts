import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseRangeResponse, pwnedPasswordCount, isPasswordPwned } from "../pwned-passwords";

describe("parseRangeResponse", () => {
  it("returns count when suffix matches", () => {
    const body = [
      "AAAAA:1",
      "BBBBB:42",
      "CCCCC:0", // padding
    ].join("\n");
    expect(parseRangeResponse(body, "BBBBB")).toBe(42);
  });

  it("is case-insensitive on suffix", () => {
    const body = "FFFF1ABC:7";
    expect(parseRangeResponse(body, "ffff1abc")).toBe(7);
  });

  it("returns 0 when suffix not present", () => {
    expect(parseRangeResponse("AAAAA:1\nBBBBB:2", "ZZZZZ")).toBe(0);
  });

  it("handles CRLF line endings", () => {
    expect(parseRangeResponse("AAAAA:5\r\nBBBBB:10\r\n", "BBBBB")).toBe(10);
  });

  it("ignores malformed lines", () => {
    expect(parseRangeResponse("garbage\nAAAAA:9", "AAAAA")).toBe(9);
  });

  it("returns 0 on empty body", () => {
    expect(parseRangeResponse("", "AAAAA")).toBe(0);
  });
});

describe("pwnedPasswordCount", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    // Reset between tests
    global.fetch = realFetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns count when HIBP responds with a hit", async () => {
    // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // Prefix: 5BAA6, suffix: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9999999",
    } as Response) as typeof fetch;

    const count = await pwnedPasswordCount("password");
    expect(count).toBe(9999999);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/range/5BAA6"),
      expect.any(Object),
    );
  });

  it("returns 0 when password is not in any breach", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "OTHERSUFFIX:5",
    } as Response) as typeof fetch;

    const count = await pwnedPasswordCount("a-very-unique-passphrase-2026");
    expect(count).toBe(0);
  });

  it("fails open on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    const count = await pwnedPasswordCount("anything");
    expect(count).toBe(0);
  });

  it("fails open on 500 from HIBP", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response) as typeof fetch;
    const count = await pwnedPasswordCount("anything");
    expect(count).toBe(0);
  });

  it("returns 0 for empty password", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as typeof fetch;
    const count = await pwnedPasswordCount("");
    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends Add-Padding header for response-size obfuscation", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    } as Response) as typeof fetch;
    await pwnedPasswordCount("test");
    const opts = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.headers["Add-Padding"]).toBe("true");
    expect(opts.headers["User-Agent"]).toContain("iKratom");
  });
});

describe("isPasswordPwned", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "1E4C9B93F3F0682250B6CF8331B7EE68FD8:42",
    } as Response) as typeof fetch;
  });

  it("returns true when count >= minCount (default 1)", async () => {
    expect(await isPasswordPwned("password")).toBe(true);
  });

  it("respects custom minCount threshold", async () => {
    expect(await isPasswordPwned("password", 100)).toBe(false);
    expect(await isPasswordPwned("password", 42)).toBe(true);
  });
});
