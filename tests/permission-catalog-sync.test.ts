import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PERMISSION_CATALOG, OWNER_ONLY_KEYS } from "../src/modules/admin/permissions";

/**
 * The permission catalog exists twice: in TypeScript (authoritative for app
 * checks — one query, no per-check round trip) and inside has_permission() in
 * SQL (used by RLS policies). Two copies of a security rule drift, and drift
 * here means the database and the app disagree about who can do what.
 *
 * This parses the arrays out of the newest has_permission migration and
 * asserts they match the TS catalog exactly.
 */

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

/** The most recent migration that (re)defines has_permission. */
function latestHasPermissionMigration(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const hits = files.filter((f) =>
    /create or replace function public\.has_permission/i.test(
      readFileSync(join(MIGRATIONS, f), "utf8"),
    ),
  );
  if (hits.length === 0) throw new Error("no migration defines has_permission");
  return readFileSync(join(MIGRATIONS, hits[hits.length - 1]), "utf8");
}

/** Pull `v_<name> text[] := array[ 'a', 'b' ];` out of the plpgsql body. */
function sqlArray(sql: string, varName: string): string[] {
  const re = new RegExp(`${varName}\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\]`, "i");
  const m = re.exec(sql);
  if (!m) throw new Error(`could not find ${varName} in the migration`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

const sql = latestHasPermissionMigration();

describe("TS catalog matches has_permission() in SQL", () => {
  it("admin defaults agree", () => {
    const fromSql = sqlArray(sql, "v_admin_perms").sort();
    const fromTs = PERMISSION_CATALOG.filter((p) =>
      (p.defaultFor as readonly string[]).includes("admin"),
    )
      .map((p) => p.key)
      .sort();
    expect(fromSql).toEqual(fromTs);
  });

  it("leader defaults agree", () => {
    const fromSql = sqlArray(sql, "v_leader_perms").sort();
    const fromTs = PERMISSION_CATALOG.filter((p) =>
      (p.defaultFor as readonly string[]).includes("leader"),
    )
      .map((p) => p.key)
      .sort();
    expect(fromSql).toEqual(fromTs);
  });

  it("owner-reserved keys agree", () => {
    expect(sqlArray(sql, "v_owner_only_perms").sort()).toEqual([...OWNER_ONLY_KEYS].sort());
  });

  it("checks the owner short-circuit before reading any override", () => {
    // Order matters: overrides first would let a stray deny lock the owner out
    // of their own platform, with raw SQL (owner-only) as the only way back.
    const ownerCheck = sql.indexOf("if v_profile.is_owner then return true");
    const overrideRead = sql.indexOf("select granted into v_explicit_grant");
    expect(ownerCheck).toBeGreaterThan(-1);
    expect(overrideRead).toBeGreaterThan(-1);
    expect(ownerCheck).toBeLessThan(overrideRead);
  });

  it("refuses owner-reserved keys before honoring an override", () => {
    const ownerOnlyGate = sql.indexOf("p_perm = any(v_owner_only_perms)");
    const overrideRead = sql.indexOf("select granted into v_explicit_grant");
    expect(ownerOnlyGate).toBeGreaterThan(-1);
    expect(ownerOnlyGate).toBeLessThan(overrideRead);
  });
});
