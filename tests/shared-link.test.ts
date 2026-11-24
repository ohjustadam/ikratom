/**
 * shared-link.test.ts — a link shared into iKratom must find the story we
 * stored, whatever spelling it arrived in (PJ, 2026-11-24).
 */
import { describe, it, expect } from "vitest";
import { firstUrl, linkVariants } from "../src/lib/shared-link";

describe("firstUrl", () => {
  it("pulls the link out of shared text, without trailing punctuation", () => {
    expect(firstUrl("Look at this: https://news.example.com/a/b. Wow")).toBe("https://news.example.com/a/b");
    expect(firstUrl("(https://x.org/story)")).toBe("https://x.org/story");
    expect(firstUrl("no link here")).toBeNull();
    expect(firstUrl(null)).toBeNull();
  });
});

describe("linkVariants", () => {
  it("covers scheme, www and trailing slash, and drops tracking params", () => {
    const v = linkVariants("https://www.Example.com/news/kratom-bill/?utm_source=fb&fbclid=abc");
    expect(v).toContain("https://example.com/news/kratom-bill");
    expect(v).toContain("https://www.example.com/news/kratom-bill/");
    expect(v).toContain("http://example.com/news/kratom-bill");
    // Only the untouched original (first) may still carry them.
    expect(v.slice(1).some((x) => /utm_|fbclid/.test(x))).toBe(false);
  });
  it("keeps query params that identify the article", () => {
    expect(linkVariants("https://paper.com/story.php?id=42")).toContain("https://paper.com/story.php?id=42");
  });
  it("tries the exact original spelling first", () => {
    expect(linkVariants("https://site.com/a?utm_medium=x")[0]).toBe("https://site.com/a?utm_medium=x");
  });
  it("refuses anything that isn't a web link", () => {
    expect(linkVariants("javascript:alert(1)")).toEqual([]);
    expect(linkVariants("ftp://site.com/x")).toEqual([]);
    expect(linkVariants("https://localhost/x")).toEqual([]);
    expect(linkVariants("")).toEqual([]);
  });
  it("stays small enough for one indexed lookup", () => {
    expect(linkVariants("https://a.com/b").length).toBeLessThanOrEqual(9);
  });
});
