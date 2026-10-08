import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import { frontmatterString } from "../frontmatter";

describe("frontmatterString", () => {
  it("renders an unquoted YAML date as YYYY-MM-DD", () => {
    // The bug this exists to prevent: `published: 2026-05-08` parses to a
    // Date, and String(date) prints "Fri May 08 2026 19:00:00 GMT-0500".
    const { data } = matter("---\npublished: 2026-05-08\n---\nbody\n");
    expect(data.published).toBeInstanceOf(Date);
    expect(frontmatterString(data.published)).toBe("2026-05-08");
  });

  it("leaves a quoted date untouched", () => {
    const { data } = matter('---\npublished: "2026-08-24"\n---\nbody\n');
    expect(frontmatterString(data.published)).toBe("2026-08-24");
  });

  it("does not shift the day across the local timezone", () => {
    // YAML parses a date-only scalar to UTC midnight; slicing the UTC date
    // back off must return the same day the author typed, regardless of
    // where the server happens to run.
    expect(frontmatterString(new Date("2026-05-08T00:00:00Z"))).toBe("2026-05-08");
    expect(frontmatterString(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });

  it("returns null for null and undefined", () => {
    expect(frontmatterString(null)).toBeNull();
    expect(frontmatterString(undefined)).toBeNull();
  });

  it("degrades to null on an unparseable date instead of throwing", () => {
    expect(frontmatterString(new Date("not a date"))).toBeNull();
  });

  it("stringifies other scalar frontmatter", () => {
    expect(frontmatterString("14 min")).toBe("14 min");
    expect(frontmatterString(8)).toBe("8");
  });
});
