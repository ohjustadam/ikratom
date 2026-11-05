import { describe, it, expect } from "vitest";
import { STALE_NEWS_DAYS, freshNewsFloor, isStaleNews, newsAgeDays } from "../scripts/lib/news-freshness.mjs";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("news freshness gate", () => {
  it("passes a story from this week", () => {
    expect(isStaleNews(daysAgo(2), NOW)).toBe(false);
    expect(isStaleNews(daysAgo(STALE_NEWS_DAYS), NOW)).toBe(false);
  });
  it("stops a June story reaching the November ticker", () => {
    expect(isStaleNews("2026-06-23T10:00:00Z", NOW)).toBe(true);
    expect(isStaleNews(daysAgo(STALE_NEWS_DAYS + 1), NOW)).toBe(true);
  });
  it("never calls an undated story stale", () => {
    expect(isStaleNews(null, NOW)).toBe(false);
    expect(isStaleNews("not a date", NOW)).toBe(false);
    expect(newsAgeDays(undefined, NOW)).toBeNull();
  });
  it("puts the default query floor exactly at the window", () => {
    expect(freshNewsFloor(NOW)).toBe(daysAgo(STALE_NEWS_DAYS));
  });
});
