import { describe, it, expect } from "vitest";
import { validateProfileInput, type ProfileInput } from "@/modules/profile/validate";
import { AUDIENCES, DEFAULT_AUDIENCES, SECTION_AUDIENCES, isAudience } from "@/modules/profile/audience";
import { readFileSync } from "node:fs";

const base: ProfileInput = { bio: "", story: "", interests: [], links: [], audiences: {} };
const ok = (r: ReturnType<typeof validateProfileInput>) => {
  if ("error" in r) throw new Error(r.error);
  return r.value;
};

describe("profile editor validation", () => {
  it("accepts an empty profile with safe defaults", () => {
    const v = ok(validateProfileInput(base));
    expect(v.bio).toBeNull();
    expect(v.audiences).toEqual(DEFAULT_AUDIENCES);
    expect(v.audiences.photos_default_audience).toBe("friends");
    expect(v.audiences.friends_audience).toBe("friends");
  });

  it("refuses phone numbers and emails in public text", () => {
    expect(validateProfileInput({ ...base, bio: "call me 405-555-0134" })).toHaveProperty("error");
    expect(validateProfileInput({ ...base, story: "write to me@example.com" })).toHaveProperty("error");
  });

  it("enforces the length caps", () => {
    expect(validateProfileInput({ ...base, bio: "x".repeat(301) })).toHaveProperty("error");
    expect(validateProfileInput({ ...base, story: "x".repeat(2001) })).toHaveProperty("error");
  });

  it("only allows interests from the fixed vocabulary", () => {
    expect(ok(validateProfileInput({ ...base, interests: ["veteran", "veteran"] })).interests).toEqual(["veteran"]);
    expect(validateProfileInput({ ...base, interests: ["my home town"] })).toHaveProperty("error");
  });

  it("only allows https links to public hosts", () => {
    expect(ok(validateProfileInput({ ...base, links: [{ label: "Blog", url: "https://example.org/a" }] })).links).toHaveLength(1);
    for (const url of ["http://example.org", "javascript:alert(1)", "https://127.0.0.1/", "https://user:pw@example.org", "https://example.org:8080/"]) {
      expect(validateProfileInput({ ...base, links: [{ label: "x", url }] })).toHaveProperty("error");
    }
    expect(validateProfileInput({ ...base, links: [{ label: "", url: "https://example.org" }] })).toHaveProperty("error");
    // Blank rows are dropped, not errors.
    expect(ok(validateProfileInput({ ...base, links: [{ label: "", url: "" }] })).links).toHaveLength(0);
  });

  it("rejects an unknown privacy level", () => {
    expect(validateProfileInput({ ...base, audiences: { bio_audience: "everyone" } })).toHaveProperty("error");
    expect(ok(validateProfileInput({ ...base, audiences: { bio_audience: "only_me" } })).audiences.bio_audience).toBe("only_me");
  });
});

describe("audience vocabulary matches the database", () => {
  // Section columns: 0285, plus wall_audience from the wall migration (0292).
  const sql = ["0285_social_profiles", "0292_profile_wall"]
    .map((f) => readFileSync(`supabase/migrations/${f}.sql`, "utf8")).join("\n");

  it("has the same four levels as the check constraint", () => {
    expect([...AUDIENCES]).toEqual(["only_me", "friends", "members", "public"]);
    expect(sql).toContain("in ('only_me', 'friends', 'members', 'public')");
    expect(isAudience("everyone")).toBe(false);
  });

  it("every section key is a profile_social column with the same default", () => {
    for (const { key } of SECTION_AUDIENCES) {
      expect(sql).toMatch(new RegExp(`\\b${key}\\s+text not null default '${DEFAULT_AUDIENCES[key]}'`));
    }
  });
});
