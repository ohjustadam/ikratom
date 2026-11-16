/**
 * Group discussion posts hold 10,000 characters (PJ, 2026-11-11: his letter to
 * an editor was cut off at 5,000). The limit lives in four places that must
 * agree: the shared constant, the server action, the forms and the database.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { GROUP_POST_MAX, GROUP_TITLE_MAX, groupPostLengthNote } from "../src/modules/coalitions/limits";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const actions = read("src/modules/coalitions/discussion-actions.ts");
const newThread = read("src/app/coalitions/[slug]/NewThreadForm.tsx");
const threadClient = read("src/app/coalitions/[slug]/t/[threadId]/ThreadClient.tsx");

/** The latest migration that sets each group body check, and the number it sets. */
function dbBodyCap(table: "coalition_threads" | "coalition_posts"): number {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  let cap = NaN;
  const re = new RegExp(
    `add constraint ${table}_body_check\\s+check \\(char_length\\(body\\) <= (\\d+)\\)`,
    "g",
  );
  for (const f of files) {
    // Rollback notes sit in comments; only real statements count.
    const sql = readFileSync(new URL(f, dir), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(re)) cap = Number(m[1]);
  }
  return cap;
}

describe("the limit", () => {
  it("is 10,000 characters, with the title unchanged", () => {
    expect(GROUP_POST_MAX).toBe(10_000);
    expect(GROUP_TITLE_MAX).toBe(140);
  });

  it("matches the database checks on threads and replies", () => {
    expect(dbBodyCap("coalition_threads")).toBe(GROUP_POST_MAX);
    expect(dbBodyCap("coalition_posts")).toBe(GROUP_POST_MAX);
  });

  it("is what the server action enforces, with spam and rate limits still in place", () => {
    expect(actions).toMatch(/import \{ GROUP_POST_MAX, GROUP_TITLE_MAX \} from "\.\/limits"/);
    expect(actions).not.toMatch(/5000|5_000/);
    // Three writes check it: start a discussion, reply, edit.
    expect(actions.match(/b\.length > MAX_BODY/g)).toHaveLength(3);
    expect(actions.match(/sellingIssue\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(actions).toMatch(/checkRateLimit\(`coalition:thread:\$\{ctx\.user\.id\}`, 5, 3600\)/);
    expect(actions).toMatch(/checkRateLimit\(`coalition:reply:\$\{ctx\.user\.id\}`, 30, 3600\)/);
    expect(actions).toMatch(/checkRateLimit\(`coalition:edit:\$\{ctx\.user\.id\}`, 30, 3600\)/);
  });
});

describe("the forms", () => {
  it("never cut a long paste silently: no hard maxLength on a post box", () => {
    for (const src of [newThread, threadClient]) {
      expect(src).not.toMatch(/maxLength=\{5000\}/);
      expect(src).not.toMatch(/maxLength=\{GROUP_POST_MAX\}/);
    }
  });

  it("show the count and hold the Post button while the text is too long", () => {
    expect(newThread).toMatch(/<PostLengthNote length=\{body\.trim\(\)\.length\} \/>/);
    expect(newThread).toMatch(/disabled=\{pending \|\| body\.trim\(\)\.length > GROUP_POST_MAX\}/);
    // The reply box and the edit box.
    expect(threadClient.match(/<PostLengthNote /g)).toHaveLength(2);
    expect(threadClient.match(/\.trim\(\)\.length > GROUP_POST_MAX/g)).toHaveLength(2);
  });
});

describe("groupPostLengthNote", () => {
  it("stays out of the way for a short post", () => {
    expect(groupPostLengthNote(0)).toBeNull();
    expect(groupPostLengthNote(4_500)).toBeNull();
    expect(groupPostLengthNote(7_999)).toBeNull();
  });

  it("counts once a post gets long", () => {
    expect(groupPostLengthNote(8_000)).toEqual({ text: "8,000 / 10,000 characters", over: false });
    expect(groupPostLengthNote(10_000)).toEqual({ text: "10,000 / 10,000 characters", over: false });
  });

  it("says how much to cut when it's over", () => {
    expect(groupPostLengthNote(12_345)).toEqual({
      text: "12,345 / 10,000 characters. Cut 2,345 to post.",
      over: true,
    });
  });
});
