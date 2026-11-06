import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { summarizeContentSignals } from "@/lib/abuse-content-signals";

const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString();
const profiles = [
  { id: "new1", username: "fresh_one", created_at: day(3) },
  { id: "new2", username: "fresh_two", created_at: day(4) },
  { id: "old", username: "longtimer", created_at: day(1).replace("2026", "2025") },
];
const empty = { blocks: [], reports: [], groups: [], profiles, hidden: 0 };

describe("content signals", () => {
  it("counts refused letters by reason and account, and names repeats", () => {
    const s = summarizeContentSignals({
      ...empty,
      blocks: [
        { user_id: "new1", category: "bans_natural_kratom" },
        { user_id: "new1", category: "bans_natural_kratom" },
        { user_id: "old", category: "threat" },
      ],
    }).blocks;
    expect(s).toMatchObject({ total: 3, banAsks: 2, threats: 1, accounts: 2 });
    expect(s.repeat).toEqual([{ handle: "@fresh_one", count: 2 }]);
  });

  it("flags a report only when the account was under 7 days old at the time", () => {
    const s = summarizeContentSignals({
      ...empty,
      reports: [
        { reporter_id: "new1", created_at: day(5) },
        { reporter_id: "new2", created_at: day(5) },
        { reporter_id: "new2", created_at: day(6) },
        { reporter_id: "new1", created_at: day(20) }, // same account, no longer new
        { reporter_id: "old", created_at: day(5) },
      ],
    }).newReporters;
    expect(s).toMatchObject({ reports: 3, accounts: 2 });
    expect(s.top).toEqual([{ handle: "@fresh_two", count: 2 }]);
  });

  it("flags a group only when a new account started it", () => {
    const s = summarizeContentSignals({
      ...empty,
      groups: [
        { name: "Fresh", slug: "fresh", owner_id: "new1", created_at: day(5) },
        { name: "Settled", slug: "settled", owner_id: "old", created_at: day(5) },
      ],
    });
    expect(s.newGroups).toEqual([{ name: "Fresh", slug: "fresh", handle: "@fresh_one" }]);
  });

  it("doesn't call an account new when it can't find the account", () => {
    const s = summarizeContentSignals({ ...empty, reports: [{ reporter_id: "gone", created_at: day(5) }] });
    expect(s.newReporters.reports).toBe(0);
  });

  it("passes the hidden count through", () => {
    expect(summarizeContentSignals({ ...empty, hidden: 4 }).hidden).toBe(4);
  });
});

describe("refused letters are recorded on every member path", () => {
  const paths = ["src/modules/campaigns/actions.ts", "src/modules/campaigns/send-batch-actions.ts"];
  for (const p of paths) {
    it(p, () => {
      const src = readFileSync(p, "utf8");
      expect(src).toMatch(/screenLetterFrom\(/);
      expect(src).not.toMatch(/screenMemberLetter\(/);
    });
  }
  it("stores who, why and when, never the letter", () => {
    const src = readFileSync("src/modules/campaigns/letter-blocks.ts", "utf8");
    expect(src).toMatch(/\.insert\(\{ user_id: userId, category \}\)/);
    const sql = readFileSync("supabase/migrations/0314_letter_screen_blocks.sql", "utf8");
    expect(sql).not.toMatch(/\b(subject|body|letter_text)\s+text/);
  });
  it("shows members by @username only", () => {
    const src = readFileSync("src/modules/admin/abuse-content-signals.ts", "utf8");
    expect(src).toMatch(/\.select\("id, username, created_at"\)/);
    expect(src).not.toMatch(/full_name|email/);
  });
});
