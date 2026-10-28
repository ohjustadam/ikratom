import { describe, expect, it } from "vitest";
import { extractMentions, splitMentions, mentionAtCaret, completeMention, MAX_MENTIONS_PER_MESSAGE } from "@/lib/mentions";

describe("extractMentions", () => {
  it("finds handles at the start, mid-sentence and after punctuation", () => {
    expect(extractMentions("@Paul_E hi (@sam) and @kim!")).toEqual(["paul_e", "sam", "kim"]);
  });

  it("ignores emails and doubled @", () => {
    expect(extractMentions("mail me at paul@example.com or @@nope")).toEqual([]);
  });

  it("de-duplicates case-insensitively and caps per message", () => {
    expect(extractMentions("@a1 @A1 @b2 @c3 @d4 @e5")).toEqual(["a1", "b2", "c3"]);
    expect(MAX_MENTIONS_PER_MESSAGE).toBe(3);
  });

  it("returns nothing for plain text", () => {
    expect(extractMentions("no tags here")).toEqual([]);
    expect(extractMentions("")).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("keeps every character and marks the mentions", () => {
    const parts = splitMentions("hey @Sam, see @kim");
    expect(parts.map((p) => p.text).join("")).toBe("hey @Sam, see @kim");
    expect(parts.filter((p) => p.mention).map((p) => p.mention)).toEqual(["sam", "kim"]);
  });

  it("leaves emails as plain text", () => {
    expect(splitMentions("a@b.com")).toEqual([{ text: "a@b.com" }]);
  });
});

describe("autocomplete helpers", () => {
  it("finds the @word under the caret", () => {
    expect(mentionAtCaret("hi @pa", 6)).toEqual({ query: "pa", start: 3 });
    expect(mentionAtCaret("@", 1)).toEqual({ query: "", start: 0 });
    expect(mentionAtCaret("mail a@b", 8)).toBeNull();
    expect(mentionAtCaret("hi there", 8)).toBeNull();
  });

  it("completes the handle and adds one space", () => {
    expect(completeMention("hi @pa thanks", 3, 6, "paul_e")).toBe("hi @paul_e thanks");
    expect(completeMention("@k", 0, 2, "kim")).toBe("@kim ");
  });
});
