/**
 * media-board.test.ts — the /media Top 5 (PJ, 2026-11-24): this week only,
 * most relevant first, one card per story; the leaderboard month starts at
 * midnight Eastern.
 */
import { describe, it, expect } from "vitest";
import { pickTop5, monthStartEastern, type BoardCandidate } from "../src/lib/media-board";

const NOW = Date.parse("2026-11-24T17:00:00Z");
const ago = (d: number) => new Date(NOW - d * 864e5).toISOString();
const row = (id: string, days: number, score: number | null): BoardCandidate =>
  ({ contactId: `c${id}`, newsId: `n${id}`, title: id, name: null, outlet: null, publishedAt: ago(days), score });

describe("pickTop5", () => {
  it("keeps the last 7 days, most relevant first, five at most", () => {
    const top = pickTop5([row("a", 1, 0.2), row("b", 2, 0.9), row("c", 8, 1), row("d", 3, 0.5), row("e", 0.5, null),
      row("f", 4, 0.7), row("g", 5, 0.6), row("h", 6, 0.1)], NOW);
    expect(top.map((t) => t.title)).toEqual(["b", "f", "g", "d", "a"]);
  });
  it("one card per story, and nothing dated in the future or undated", () => {
    const top = pickTop5([row("a", 1, 0.5), { ...row("a", 1, 0.5), contactId: "dup" }, row("z", -3, 1),
      { ...row("u", 1, 1), publishedAt: null }], NOW);
    expect(top.map((t) => t.contactId)).toEqual(["ca"]);
  });
  it("a tie on score goes to the newer story", () => {
    expect(pickTop5([row("old", 5, 0.5), row("new", 1, 0.5)], NOW).map((t) => t.title)).toEqual(["new", "old"]);
  });
});

describe("monthStartEastern", () => {
  it("is midnight Eastern on the 1st, in EST and in EDT", () => {
    expect(monthStartEastern(NOW)).toBe("2026-11-01T04:00:00.000Z"); // Nov 1 2026 is still EDT at midnight
    expect(monthStartEastern(Date.parse("2026-12-15T12:00:00Z"))).toBe("2026-12-01T05:00:00.000Z");
    expect(monthStartEastern(Date.parse("2026-07-04T12:00:00Z"))).toBe("2026-07-01T04:00:00.000Z");
  });
  it("just after midnight UTC on the 1st is still last month in Eastern", () => {
    expect(monthStartEastern(Date.parse("2026-12-01T02:00:00Z"))).toBe("2026-11-01T04:00:00.000Z");
  });
});
