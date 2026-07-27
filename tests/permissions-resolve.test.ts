import { describe, it, expect } from "vitest";
import {
  resolvePermissions,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  OWNER_ONLY_KEYS,
  isOwnerOnly,
} from "../src/modules/admin/permissions";

/**
 * resolvePermissions() is the single decision point for "can this person do
 * this?" — the server gates on it and the matrix UI renders from it. These
 * cover the precedence rules that are easy to get subtly wrong.
 */

const OWNER = { isOwner: true, isAdmin: false, isLeader: false };
const ADMIN = { isOwner: false, isAdmin: true, isLeader: false };
const LEADER = { isOwner: false, isAdmin: false, isLeader: true };
const USER = { isOwner: false, isAdmin: false, isLeader: false };

describe("resolvePermissions", () => {
  it("gives the owner every permission, owner-reserved included", () => {
    const p = resolvePermissions(OWNER);
    expect(p.size).toBe(PERMISSION_KEYS.length);
    for (const key of OWNER_ONLY_KEYS) expect(p.has(key as never)).toBe(true);
  });

  it("ignores explicit denies against the owner (no self-lockout)", () => {
    // The recovery path for a bricked owner would be raw SQL, which is itself
    // owner-only — so this rule is what stops a mis-click being unrecoverable.
    const p = resolvePermissions(OWNER, [
      { permission: "run_sql", granted: false },
      { permission: "manage_roles", granted: false },
      { permission: "view_admin_dashboard", granted: false },
    ]);
    expect(p.has("run_sql")).toBe(true);
    expect(p.has("manage_roles")).toBe(true);
    expect(p.has("view_admin_dashboard")).toBe(true);
  });

  it("never grants an owner-reserved permission to anyone else, even with an explicit grant row", () => {
    for (const roles of [ADMIN, LEADER, USER]) {
      const p = resolvePermissions(
        roles,
        OWNER_ONLY_KEYS.map((k) => ({ permission: k, granted: true })),
      );
      for (const key of OWNER_ONLY_KEYS) expect(p.has(key as never)).toBe(false);
    }
  });

  it("applies admin and leader role defaults", () => {
    const admin = resolvePermissions(ADMIN);
    const leader = resolvePermissions(LEADER);
    expect(admin.has("moderate_lounge")).toBe(true);
    expect(leader.has("moderate_lounge")).toBe(false);
    // Leaders author campaigns but do not approve them.
    expect(leader.has("author_campaigns")).toBe(true);
    expect(leader.has("approve_campaigns")).toBe(false);
    expect(admin.has("approve_campaigns")).toBe(true);
  });

  it("grants a leader one extra capability without making them an admin", () => {
    // The owner's stated use case: delegate a single power, keep the role.
    const p = resolvePermissions(LEADER, [{ permission: "moderate_lounge", granted: true }]);
    expect(p.has("moderate_lounge")).toBe(true);
    // ...and nothing else leaks in.
    expect(p.has("view_users_list")).toBe(false);
    expect(p.has("edit_bills")).toBe(false);
    expect(p.has("use_ai_editor")).toBe(false);
  });

  it("revokes a single capability from an admin, leaving the rest intact", () => {
    const p = resolvePermissions(ADMIN, [{ permission: "edit_bills", granted: false }]);
    expect(p.has("edit_bills")).toBe(false);
    expect(p.has("moderate_forum")).toBe(true);
    expect(p.has("view_users_list")).toBe(true);
  });

  it("gives a plain user nothing by default", () => {
    expect(resolvePermissions(USER).size).toBe(0);
  });

  it("can hand a plain user a single permission", () => {
    const p = resolvePermissions(USER, [{ permission: "moderate_stories", granted: true }]);
    expect([...p]).toEqual(["moderate_stories"]);
  });

  it("ignores override rows for keys that are not in the catalog", () => {
    const p = resolvePermissions(LEADER, [{ permission: "not_a_real_permission", granted: true }]);
    expect(p.has("not_a_real_permission" as never)).toBe(false);
  });
});

describe("catalog integrity", () => {
  it("has unique keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("marks owner-reserved permissions as default-for-nobody", () => {
    // An ownerOnly key with a role default would be contradictory: the
    // resolver skips it, so the default would be a silent lie in the UI.
    for (const p of PERMISSION_CATALOG) {
      if (isOwnerOnly(p.key)) {
        expect(p.defaultFor, `${p.key} is ownerOnly so defaultFor must be empty`).toEqual([]);
      }
    }
  });

  it("keeps the six owner-reserved capabilities locked", () => {
    // Change this list only with a deliberate decision — each one is a way to
    // become the owner in practice.
    expect([...OWNER_ONLY_KEYS].sort()).toEqual(
      [
        "dispatch_workflows",
        "export_advocate_pii",
        "lock_accounts",
        "manage_permissions",
        "manage_roles",
        "run_sql",
      ].sort(),
    );
  });
});
