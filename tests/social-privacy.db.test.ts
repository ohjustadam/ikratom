/**
 * Social privacy levels, proven in the live database (B4b, migrations 0285+).
 *
 * Each tests/sql/social-*.sql suite is one DO block that creates throwaway
 * members, reads as anon / a member / a friend / a blocked member / the owner,
 * and ALWAYS raises at the end, so the transaction rolls back with zero residue.
 * It runs through the Supabase Management API as postgres (the same path as
 * `npm run db:push`), because switching roles and forging JWT claims needs it.
 *
 * Excluded from `npm run verify` / CI (`*.db.test.ts`), like rls.test.ts: it
 * needs SUPABASE_ACCESS_TOKEN and talks to production. Run it with
 * `npm run test:db` after any change to the social tables or RPCs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

const SUITES = [
  { file: "tests/sql/social-privacy.sql", marker: "SOCIAL_PRIVACY", what: "profile sections" },
  { file: "tests/sql/social-photos.sql", marker: "SOCIAL_PHOTOS", what: "photos, avatars and photo reports" },
  { file: "tests/sql/social-connections.sql", marker: "SOCIAL_CONNECTIONS", what: "connections and friend lists" },
  { file: "tests/sql/social-reports.sql", marker: "SOCIAL_REPORTS", what: "the generic report system" },
  { file: "tests/sql/social-wall.sql", marker: "SOCIAL_WALL", what: "the profile wall, its comments and photos" },
];

describe.skipIf(!TOKEN || !REF)("social privacy levels (live DB, rolled back)", () => {
  it.each(SUITES)("$what: every viewer sees exactly what each audience allows", async ({ file, marker }) => {
    const sql = readFileSync(file, "utf8");
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const body = await res.text();
    // The block always raises; success is the OK marker in the error message.
    expect(body).not.toContain(`${marker}_FAIL`);
    expect(body).toMatch(new RegExp(`${marker}_OK checks=\\d+`));
  }, 60_000);
});
