import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { looksLikeLink, unapprovedLinks } from "@/lib/moderation";

describe("which chat links wait for a moderator", () => {
  const held = [
    "Best prices at https://buykratom.shop today",
    "check out buykratom.shop",
    "www.mykratomstore.com has it",
    "join here https://discord.gg/abc123 http://example.net",
  ];
  for (const text of held) {
    it(`holds: ${text}`, () => expect(unapprovedLinks(text).length).toBeGreaterThan(0));
  }

  const posted = [
    "Read the bill at https://www.congress.gov/bill/119th-congress/house-bill/1",
    "The hearing notice is on oklegislature.gov",
    "AP covered it: https://apnews.com/article/kratom",
    "https://www.ikratom.org/bills is the tracker",
    "Please call your senator today.",
    "I.am.unsure about this one, version 1.2.3",
  ];
  for (const text of posted) {
    it(`posts: ${text}`, () => expect(unapprovedLinks(text)).toEqual([]));
  }

  it("the first-day rule still sees trusted links too", () => {
    expect(looksLikeLink("https://apnews.com/article/kratom")).toBe(true);
    expect(looksLikeLink("Please call your senator today.")).toBe(false);
  });
});

describe("the Lounge holds a link before it can post", () => {
  const src = readFileSync("src/modules/chat/actions.ts", "utf8");
  it("after the rate limit, so a spammer can't fill the queue", () => {
    const hold = src.indexOf("unapprovedLinks(body)");
    expect(hold).toBeGreaterThan(src.indexOf("checkRateLimit(`chat:user:"));
    expect(hold).toBeLessThan(src.indexOf('.from("chat_messages")\n    .insert') > -1 ? src.indexOf('.from("chat_messages")\n    .insert') : src.lastIndexOf('from("chat_messages")'));
  });
  it("never posts the link when the hold fails", () => {
    const block = src.slice(src.indexOf("unapprovedLinks(body)"), src.indexOf("AI abuse moderation"));
    expect(block).toMatch(/if \(holdErr\) \{[\s\S]*return \{ error:/);
  });
  it("staff are not held", () => {
    const before = src.slice(0, src.indexOf("unapprovedLinks(body)"));
    expect(before.slice(before.lastIndexOf("if ("))).toMatch(/!isPrivileged/);
  });
});

describe("group chat keeps the first-day link rule", () => {
  const src = readFileSync("src/modules/coalitions/chat-actions.ts", "utf8");
  it("checks the account's age before it writes", () => {
    const gate = src.indexOf("looksLikeLink(body)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(src.indexOf('.from("coalition_chat_messages")\n    .insert') > -1 ? src.indexOf('.from("coalition_chat_messages")\n    .insert') : src.indexOf(".insert({ coalition_id"));
  });
});
