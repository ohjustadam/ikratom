import { describe, expect, it } from "vitest";
import { ADMIN_MFA_ENFORCED, ADMIN_MFA_ENROLL_MESSAGE, requireMfaForMutation } from "@/modules/admin/mfa";
import { wasMfaRequired } from "@/lib/mfa-error";

// Admin and owner mutations need an enrolled, verified factor. Members were
// told it starts Mon 2026-11-23; the owner said go on 2026-11-25, so the
// block ships ON (ADMIN_MFA_ENFORCED).
const admin = { isAdmin: true, isOwner: false };
const owner = { isAdmin: false, isOwner: true };
const leader = { isAdmin: false, isOwner: false };

describe("requireMfaForMutation, as shipped (flag on)", () => {
  it("ships with enforcement on", () => {
    expect(ADMIN_MFA_ENFORCED).toBe(true);
  });

  it("blocks an admin or owner with no factor without any override", () => {
    expect(requireMfaForMutation({ ...admin, aal: "aal1", aalNext: "aal1" })).toBe(ADMIN_MFA_ENROLL_MESSAGE);
    expect(requireMfaForMutation({ ...owner, aal: null, aalNext: null })).toBe(ADMIN_MFA_ENROLL_MESSAGE);
  });

  it("still asks an enrolled admin at aal1 for the code (inline prompt)", () => {
    expect(wasMfaRequired(requireMfaForMutation({ ...admin, aal: "aal1", aalNext: "aal2" }))).toBe(true);
  });

  it("enforce: false still restores the grace rule (the off switch works)", () => {
    expect(requireMfaForMutation({ ...admin, enforce: false, aal: "aal1", aalNext: "aal1" })).toBeNull();
  });
});

describe("requireMfaForMutation, enforced", () => {
  const on = { enforce: true };

  it("blocks an admin with no factor and says where to enroll", () => {
    const err = requireMfaForMutation({ ...admin, ...on, aal: "aal1", aalNext: "aal1" });
    expect(err).toBe(ADMIN_MFA_ENROLL_MESSAGE);
    expect(err).toContain("/account/security");
    // No factor to enter, so the inline code prompt must not open.
    expect(wasMfaRequired(err)).toBe(false);
  });

  it("blocks an owner with no factor too", () => {
    expect(requireMfaForMutation({ ...owner, ...on, aal: "aal1", aalNext: "aal1" })).toBe(ADMIN_MFA_ENROLL_MESSAGE);
    expect(requireMfaForMutation({ ...owner, ...on, aal: null, aalNext: null })).toBe(ADMIN_MFA_ENROLL_MESSAGE);
  });

  it("asks an enrolled admin at aal1 for the code (inline prompt)", () => {
    const err = requireMfaForMutation({ ...admin, ...on, aal: "aal1", aalNext: "aal2" });
    expect(wasMfaRequired(err)).toBe(true);
  });

  it("lets an enrolled owner or admin at aal2 through", () => {
    expect(requireMfaForMutation({ ...owner, ...on, aal: "aal2", aalNext: "aal2" })).toBeNull();
    expect(requireMfaForMutation({ ...admin, ...on, aal: "aal2", aalNext: "aal2" })).toBeNull();
  });

  it("keeps the signed backup-code bypass", () => {
    expect(requireMfaForMutation({ ...admin, ...on, aal: "aal1", aalNext: "aal1", mfaBypass: true })).toBeNull();
    expect(requireMfaForMutation({ ...owner, ...on, aal: "aal1", aalNext: "aal2", mfaBypass: true })).toBeNull();
  });

  it("leaves a plain leader on the grace rule", () => {
    expect(requireMfaForMutation({ ...leader, ...on, aal: "aal1", aalNext: "aal1" })).toBeNull();
    expect(wasMfaRequired(requireMfaForMutation({ ...leader, ...on, aal: "aal1", aalNext: "aal2" }))).toBe(true);
  });
});
