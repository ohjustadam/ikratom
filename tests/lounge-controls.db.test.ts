/**
 * Lounge prefs + reactions RLS, proven in the live database (B8, mig 0336).
 *
 * tests/sql/lounge-controls.sql is one DO block that creates throwaway
 * members, acts as each of them, as a muted member and as anon, and ALWAYS
 * raises at the end, so the transaction rolls back with zero residue. It runs
 * through the Supabase Management API as postgres (the same path as
 * `npm run db:push`), because switching roles and forging JWT claims needs it.
 *
 * Excluded from `npm run verify` / CI (`*.db.test.ts`): it needs
 * SUPABASE_ACCESS_TOKEN and talks to production. Run it with
 * `npx vitest run tests/lounge-controls.db.test.ts` after changing either table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

describe.skipIf(!TOKEN || !REF)("lounge prefs and reactions (live DB, rolled back)", () => {
  it("self-only prefs, signed-in reactions, fixed emoji, muted can't react", async () => {
    const sql = readFileSync("tests/sql/lounge-controls.sql", "utf8");
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const body = await res.text();
    // The block always raises; success is the OK marker in the error message.
    expect(body).not.toContain("LOUNGE_CONTROLS_FAIL");
    expect(body).toMatch(/LOUNGE_CONTROLS_OK checks=\d+/);
  }, 60_000);
});
