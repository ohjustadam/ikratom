/**
 * Group features, proven in the live database (B4 tranche 2, migrations 0291+).
 *
 * Each tests/sql/coalition-*.sql suite is one DO block that creates throwaway
 * members and a throwaway group, reads and writes as an organizer, a member,
 * an outsider and anon, and ALWAYS raises at the end, so the transaction rolls
 * back with zero residue. Same runner as social-privacy.db.test.ts: the
 * Supabase Management API as postgres, so it can switch roles and forge JWT
 * claims.
 *
 * Excluded from `npm run verify` / CI (`*.db.test.ts`): it needs
 * SUPABASE_ACCESS_TOKEN and talks to production. Run it with `npm run test:db`
 * after any change to the group tables or RPCs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

const SUITES = [
  { file: "tests/sql/coalition-chat.sql", marker: "COALITION_CHAT", what: "group chat" },
  { file: "tests/sql/coalition-resources.sql", marker: "COALITION_RESOURCES", what: "pinned resources and templates" },
  { file: "tests/sql/coalition-leaderboard.sql", marker: "COALITION_LEADERBOARD", what: "the opt-in leaderboard" },
];

describe.skipIf(!TOKEN || !REF)("group features (live DB, rolled back)", () => {
  it.each(SUITES)("$what: members only, organizers moderate, reports land", async ({ file, marker }) => {
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
