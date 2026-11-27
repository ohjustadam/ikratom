import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { USER_LINKS_SQL, judgeUserLinks } from "../scripts/lib/user-link-indexes.mjs";

const link = (name: string, indexed: boolean) => ({ link: name, indexed });

describe("every link to a user has an index", () => {
  it("passes only when all of them do", () => {
    expect(judgeUserLinks([link("a.user_id", true), link("b.user_id", true)]).ok).toBe(true);
  });
  it("names the ones that don't", () => {
    const v = judgeUserLinks([link("a.user_id", true), link("b.reviewed_by", false)]);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["b.reviewed_by"]);
    expect(v.summary).toBe("1 of 2 user links without an index");
  });
  it("treats an empty or broken reading as a failed read, never as clean", () => {
    for (const rows of [[], null, { message: "permission denied" }]) {
      const v = judgeUserLinks(rows);
      expect(v.ok).toBe(false);
      expect(v.readNothing).toBe(true);
    }
  });
  it("looks at links to both the auth account and the profile", () => {
    expect(USER_LINKS_SQL).toContain("'auth.users'::regclass");
    expect(USER_LINKS_SQL).toContain("'public.profiles'::regclass");
  });
});

describe("the weekly check acts on it", () => {
  const src = readFileSync("scripts/check-security-advisors.mjs", "utf8");
  it("reads the links without write access", () => {
    expect(src).toMatch(/query: USER_LINKS_SQL, read_only: true/);
  });
  it("fails the run when a link has no index", () => {
    expect(src).toMatch(/const ok = verdict\.ok && links\.ok;/);
    expect(src).toMatch(/process\.exitCode = ok \? 0 : 1;/);
    expect(src).toMatch(/status: ok \? "success" : "error"/);
  });
});
