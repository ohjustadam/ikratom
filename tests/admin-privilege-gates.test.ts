import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Regression canary for the owner/admin trust boundary.
 *
 * These four actions are the ones where "admin" and "owner" must NOT be the
 * same thing. They have no runtime test coverage (they need a live Supabase
 * session), so this guard asserts at the source level that each still checks
 * `ctx.isOwner`. If someone relaxes a gate back to a plain `getAdminContext()`
 * check, CI fails here and says why.
 *
 * Same spirit as use-server-exports.test.ts: cheap static assertion standing in
 * for an integration test that would cost far more than the bug it prevents.
 *
 * Context — what makes each one owner-tier:
 *   setUserRoles ......... admin was self-replicating (an admin could promote
 *                          an alt account, or demote every other admin).
 *   generateTempPassword . returns the plaintext temp to the CALLER, so it is
 *                          the one real account-takeover path. Reset and
 *                          magic-link only ever email the target.
 *   dispatchWorkflow ..... a run executes repo code on a cloud runner holding
 *                          SUPABASE_SERVICE_ROLE_KEY.
 *   runSqlQuery .......... SECURITY DEFINER, bypasses RLS entirely.
 */

/** Slice one function's body out of a module, declaration to next top-level export. */
function functionBody(file: string, name: string): string {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in ${file} — was it renamed?`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

const USER_ACTIONS = "src/modules/admin/user-actions.ts";
const CONSOLE_ACTIONS = "src/modules/admin/console-actions.ts";
const EXPORTS_ROUTE = "src/app/api/admin/exports/route.ts";

describe("admin privilege gates", () => {
  it("setUserRoles blocks non-owners from changing is_admin", () => {
    const body = functionBody(USER_ACTIONS, "setUserRoles");
    // Guards on an is_admin *transition* (compared against current value),
    // so a non-owner can still toggle Leader on an existing admin's row.
    expect(body).toMatch(/!ctx\.isOwner\s*&&\s*!!input\.isAdmin\s*!==\s*!!prev\?\.is_admin/);
  });

  it("generateTempPassword refuses admin AND owner targets for non-owner callers", () => {
    const body = functionBody(USER_ACTIONS, "generateTempPassword");
    expect(body).toMatch(/is_owner\s*,\s*is_admin|is_admin\s*,\s*is_owner/);
    expect(body).toMatch(/target\?\.is_owner\s*\|\|\s*target\?\.is_admin/);
    expect(body).toMatch(/!ctx\.isOwner/);
  });

  it("dispatchWorkflow is owner-only", () => {
    const body = functionBody(CONSOLE_ACTIONS, "dispatchWorkflow");
    expect(body).toMatch(/if\s*\(\s*!ctx\.isOwner\s*\)/);
    // The gate must precede the network call, not merely exist somewhere.
    expect(body.indexOf("!ctx.isOwner")).toBeLessThan(body.indexOf("api.github.com"));
  });

  it("runSqlQuery is owner-only for reads as well as writes", () => {
    const body = functionBody(CONSOLE_ACTIONS, "runSqlQuery");
    expect(body).toMatch(/if\s*\(\s*!ctx\.isOwner\s*\)\s*return/);
    // Compare against the actual RPC invocation — the explanatory comment above
    // the gate also names admin_exec_sql, and matching that proves nothing.
    expect(body.indexOf("!ctx.isOwner")).toBeLessThan(body.indexOf('.rpc("admin_exec_sql"'));
  });

  it("the advocates export (names + districts) is owner-only and audit-logged", () => {
    const src = readFileSync(EXPORTS_ROUTE, "utf8");
    expect(src).toMatch(/type\s*===\s*"advocates"\s*&&\s*!p\.is_owner/);
    expect(src).toMatch(/recordAdminAction\(/);
    // The advocates query must not start selecting email without a re-review.
    const advocates = /case "advocates": \{[\s\S]*?\}/.exec(src)?.[0] ?? "";
    expect(advocates).not.toMatch(/\bemail\b/);
  });
});
