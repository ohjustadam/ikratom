import { describe, expect, it } from "vitest";
import { normalizeNewsTitle, dedupNews, type NewsItem } from "../news-dedup";

const N = (
  id: string,
  title: string,
  source_name: string | null,
  published_at: string | null,
): NewsItem => ({
  id,
  title,
  source_name,
  url: `https://example.com/${id}`,
  published_at,
  summary: null,
});

describe("normalizeNewsTitle", () => {
  it("strips News12 affiliate suffix", () => {
    const base = normalizeNewsTitle("Suffolk Lawmakers Reschedule Vote - News12 | Long Island");
    expect(normalizeNewsTitle("Suffolk Lawmakers Reschedule Vote - News12 | Bronx")).toBe(base);
    expect(normalizeNewsTitle("Suffolk Lawmakers Reschedule Vote - News 12 - Hudson Valley")).toBe(base);
  });

  it("strips Newsday suffix", () => {
    expect(normalizeNewsTitle("Suffolk lawmakers table bills on kratom ban - Newsday"))
      .toBe(normalizeNewsTitle("Suffolk lawmakers table bills on kratom ban"));
  });

  it("strips em-dash variant of outlet suffix", () => {
    expect(normalizeNewsTitle("Some headline — AOL.com"))
      .toBe(normalizeNewsTitle("Some headline"));
  });

  it("preserves headlines with no outlet suffix", () => {
    expect(normalizeNewsTitle("plain headline with no outlet"))
      .toBe("plain headline with no outlet");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeNewsTitle("a    b  c")).toBe("a b c");
  });

  it("lowercases the result", () => {
    expect(normalizeNewsTitle("MIXED Case Title")).toBe("mixed case title");
  });

  it("handles empty input", () => {
    expect(normalizeNewsTitle("")).toBe("");
  });
});

describe("dedupNews", () => {
  it("returns empty array for empty input", () => {
    expect(dedupNews([])).toEqual([]);
  });

  it("preserves a single item", () => {
    const items = [N("a", "Solo headline", "Newsday", "2026-05-13")];
    expect(dedupNews(items).length).toBe(1);
  });

  it("collapses syndicates of the same article to one row", () => {
    const items = [
      N("a", "Suffolk Vote Tabled - News12 | Bronx", "News12 | Bronx", "2026-05-13T10:00:00Z"),
      N("b", "Suffolk Vote Tabled - News12 | Long Island", "News12 | Long Island", "2026-05-13T11:00:00Z"),
      N("c", "Suffolk Vote Tabled - Newsday", "Newsday", "2026-05-13T09:00:00Z"),
    ];
    expect(dedupNews(items).length).toBe(1);
  });

  it("picks the earliest-published copy as canonical", () => {
    const items = [
      N("late",   "Same Headline - Mirror", "Mirror", "2026-05-14T00:00:00Z"),
      N("early",  "Same Headline - Origin", "Origin", "2026-05-13T00:00:00Z"),
      N("middle", "Same Headline - Echo",   "Echo",   "2026-05-13T12:00:00Z"),
    ];
    const out = dedupNews(items);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("early");
  });

  it("keeps distinct stories separate", () => {
    const items = [
      N("a", "Headline A - Newsday", "Newsday", "2026-05-13"),
      N("b", "Headline B - Newsday", "Newsday", "2026-05-12"),
    ];
    expect(dedupNews(items).length).toBe(2);
  });

  it("sorts result newest-first", () => {
    const items = [
      N("old",   "Story One - Outlet",   "Outlet", "2026-05-01"),
      N("newer", "Story Two - Outlet",   "Outlet", "2026-05-10"),
      N("newest","Story Three - Outlet", "Outlet", "2026-05-15"),
    ];
    const out = dedupNews(items);
    expect(out.map(n => n.id)).toEqual(["newest", "newer", "old"]);
  });

  it("respects the limit param", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      N(`id${i}`, `Story ${i} - Outlet`, "Outlet", `2026-05-${String(i + 1).padStart(2, "0")}`),
    );
    expect(dedupNews(items, 5).length).toBe(5);
  });

  it("handles null published_at without crashing", () => {
    const items = [
      N("a", "Headline - Outlet", "Outlet", null),
      N("b", "Headline - Other",  "Other",  null),
    ];
    const out = dedupNews(items);
    // Both normalize to same key. With both null published_at, one wins
    // (whichever was first in input — Map.set with same key keeps first
    // unless replaced by a newer-time check that never fires).
    expect(out.length).toBe(1);
  });

  it("ignores items with empty title (cannot key)", () => {
    const items = [
      N("a", "", "Outlet", "2026-05-13"),
      N("b", "Real Headline", "Outlet", "2026-05-13"),
    ];
    const out = dedupNews(items);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("b");
  });
});
