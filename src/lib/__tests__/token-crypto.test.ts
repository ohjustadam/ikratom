import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken, isEncryptedToken } from "../token-crypto";

describe("token-crypto (oauth-02 at-rest encryption)", () => {
  it("round-trips a token through encrypt → decrypt", () => {
    const tok = "1//0gAbCdEf-refresh-token_example.value";
    const enc = encryptToken(tok);
    expect(enc).not.toBe(tok);
    expect(isEncryptedToken(enc)).toBe(true);
    expect(decryptToken(enc)).toBe(tok);
  });

  it("produces a different ciphertext each time (random IV) but both decrypt", () => {
    const tok = "same-token";
    const a = encryptToken(tok);
    const b = encryptToken(tok);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(tok);
    expect(decryptToken(b)).toBe(tok);
  });

  it("passes legacy plaintext (no v1: prefix) through unchanged", () => {
    expect(decryptToken("legacy-plaintext-token")).toBe("legacy-plaintext-token");
    expect(isEncryptedToken("legacy-plaintext-token")).toBe(false);
  });

  it("treats empty/null as empty (blanked-on-revoke path)", () => {
    expect(encryptToken("")).toBe("");
    expect(decryptToken("")).toBe("");
    expect(decryptToken(null)).toBe("");
    expect(encryptToken(null)).toBe("");
  });

  it("returns '' for a corrupt v1: blob rather than throwing", () => {
    expect(decryptToken("v1:not-valid-base64-ciphertext")).toBe("");
  });
});
