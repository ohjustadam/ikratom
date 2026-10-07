/**
 * stale-deploy.test.ts — a page opened before a deploy must recover, not crash.
 *
 * 2026-10-06: every build renames server actions, so a form submitted from a
 * tab opened before a deploy got 404 x-nextjs-action-not-found and the member
 * saw "Something broke" (the owner's password reset). The error boundaries now
 * reload onto the new version; the reset form also resends itself.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { isStaleDeployError } from "@/lib/stale-deploy";

describe("isStaleDeployError", () => {
  it("recognises Next's own stale-action error", () => {
    expect(isStaleDeployError(new UnrecognizedActionError('Server Action "x" was not found on the server.'))).toBe(true);
  });
  it("recognises it by name/message too (bundled copies of the class)", () => {
    expect(isStaleDeployError({ name: "UnrecognizedActionError", message: "" })).toBe(true);
    expect(isStaleDeployError(new Error('Server Action "abc" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action'))).toBe(true);
    expect(isStaleDeployError(Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isStaleDeployError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
  });
  it("leaves real bugs alone", () => {
    expect(isStaleDeployError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
    expect(isStaleDeployError("boom")).toBe(false);
  });
});

describe("wiring", () => {
  it("both error boundaries reload onto the new version", () => {
    for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).toMatch(/isStaleDeployError\(error\) && reloadOnceForNewVersion\(\)/);
    }
  });
  it("the password-reset form resends after the reload", () => {
    const src = fs.readFileSync("src/app/forgot/ForgotForm.tsx", "utf8");
    expect(src).toMatch(/isStaleDeployError\(err\)/);
    expect(src).toMatch(/form\.requestSubmit\(\)/);
  });
});
