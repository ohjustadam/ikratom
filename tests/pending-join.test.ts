/**
 * A group invite survives signup (src/lib/pending-join.ts).
 *
 * Found 2026-11-03: a new person who scanned a group's QR code signed up,
 * confirmed their email and landed on /account, and the group was lost. The
 * group link itself could not be created at all until migration 0306.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { joinCodeFromPath, pendingJoinPath } from "../src/lib/pending-join";

describe("pending group invite", () => {
  it("reads the code from a join path, with or without a query", () => {
    expect(joinCodeFromPath("/coalitions/join/AbC123xyz")).toBe("AbC123xyz");
    expect(joinCodeFromPath("/coalitions/join/AbC123xyz?via=abcd")).toBe("AbC123xyz");
  });

  it("ignores anything that is not a join path or not a valid code", () => {
    expect(joinCodeFromPath("/dashboard")).toBeNull();
    expect(joinCodeFromPath("/coalitions/join/short")).toBeNull();
    expect(joinCodeFromPath("//evil.example/coalitions/join/AbC123xyz")).toBeNull();
    expect(joinCodeFromPath(null)).toBeNull();
  });

  it("turns a remembered code into the auto-join page, and nothing else", () => {
    expect(pendingJoinPath("AbC123xyz")).toBe("/coalitions/join/AbC123xyz?auto=1");
    expect(pendingJoinPath("../../admin")).toBeNull();
    expect(pendingJoinPath("")).toBeNull();
    expect(pendingJoinPath(undefined)).toBeNull();
  });

  it("is wired into signup, sign-in and both email-confirm routes", () => {
    const actions = readFileSync("src/modules/auth/actions.ts", "utf8");
    expect(actions).toMatch(/joinCodeFromPath\(formData\.get\("redirect"\)/);
    expect(actions).toMatch(/pendingJoinPath\(jar\.get\(PENDING_JOIN_COOKIE\)/);
    for (const route of ["src/app/auth/confirm/route.ts", "src/app/auth/callback/route.ts"]) {
      const src = readFileSync(route, "utf8");
      expect(src).toMatch(/safeNext !== "\/reset-password"[\s\S]{0,200}pendingJoinPath/);
    }
  });
});

describe("the reusable group link fits the database", () => {
  it("asks for no more uses than migration 0306 allows a reusable link", () => {
    const growth = readFileSync("src/modules/coalitions/growth-actions.ts", "utf8");
    const asked = Number(/reusable: true,\s*max_uses: (\d+)/.exec(growth)?.[1]);
    const mig = readFileSync("supabase/migrations/0306_group_link_max_uses.sql", "utf8");
    const allowed = Number(/when reusable then (\d+)/.exec(mig)?.[1]);
    expect(asked).toBeGreaterThan(100);
    expect(asked).toBeLessThanOrEqual(allowed);
  });
});
