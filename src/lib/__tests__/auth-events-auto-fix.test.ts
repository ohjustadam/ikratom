import { describe, it, expect } from "vitest";
import { attemptAutoFix } from "../auth-events-auto-fix";

const base = { kind: "oauth_callback", provider: "gmail" };

describe("attemptAutoFix", () => {
  describe("user-side errors → resolved_user_side", () => {
    it.each([
      "wrong_password",
      "invalid_credentials",
      "access_denied",
      "user_cancelled",
      "consent_denied",
      "email_not_confirmed",
    ])("classifies %s as resolved_user_side", (code) => {
      const v = attemptAutoFix({ ...base, errorCode: code });
      expect(v.outcome).toBe("resolved_user_side");
      expect(v.escalated).toBe(false);
    });
  });

  describe("transient network → resolved_transient (low volume)", () => {
    it.each(["token_exchange", "token_fetch", "network_error"])(
      "classifies %s with low volume as resolved_transient",
      (code) => {
        const v = attemptAutoFix({ ...base, errorCode: code, recurrenceCount24h: 2 });
        expect(v.outcome).toBe("resolved_transient");
        expect(v.escalated).toBe(false);
      },
    );

    it("escalates transient errors that recur ≥ 5 times", () => {
      const v = attemptAutoFix({ ...base, errorCode: "token_exchange", recurrenceCount24h: 5 });
      expect(v.outcome).toBe("escalated_unknown");
      expect(v.escalated).toBe(true);
      expect(v.notes).toMatch(/sustained outage|recurring/);
    });
  });

  describe("CSRF/cookie state → resolved_dismissed (low volume)", () => {
    it.each(["bad_state", "state_expired", "missing_state"])(
      "classifies %s with low volume as resolved_dismissed",
      (code) => {
        const v = attemptAutoFix({ ...base, errorCode: code, recurrenceCount24h: 3 });
        expect(v.outcome).toBe("resolved_dismissed");
        expect(v.escalated).toBe(false);
      },
    );

    it("escalates bad_state that recurs ≥ 10 times", () => {
      const v = attemptAutoFix({ ...base, errorCode: "bad_state", recurrenceCount24h: 12 });
      expect(v.outcome).toBe("escalated_config");
      expect(v.escalated).toBe(true);
    });
  });

  describe("config drift → escalated_config (always)", () => {
    it.each([
      "redirect_uri_mismatch",
      "invalid_client",
      "invalid_grant",
      "unauthorized_client",
      "Database error saving new user",
      "db_signup",
      "no_refresh",
    ])("classifies %s as escalated_config", (code) => {
      const v = attemptAutoFix({ ...base, errorCode: code });
      expect(v.outcome).toBe("escalated_config");
      expect(v.escalated).toBe(true);
    });
  });

  describe("unknown / missing → escalated_unknown", () => {
    it("escalates empty error_code", () => {
      const v = attemptAutoFix({ ...base, errorCode: null });
      expect(v.outcome).toBe("escalated_unknown");
      expect(v.escalated).toBe(true);
    });

    it("escalates whitespace-only error_code", () => {
      const v = attemptAutoFix({ ...base, errorCode: "   " });
      expect(v.outcome).toBe("escalated_unknown");
    });

    it("escalates novel error_code we haven't seen", () => {
      const v = attemptAutoFix({ ...base, errorCode: "totally_new_thing" });
      expect(v.outcome).toBe("escalated_unknown");
      expect(v.escalated).toBe(true);
      expect(v.notes).toMatch(/Unrecognized/);
    });
  });

  it("includes the error code in the notes for transparency", () => {
    const v = attemptAutoFix({ ...base, errorCode: "wrong_password" });
    expect(v.notes).toContain("wrong_password");
  });
});
