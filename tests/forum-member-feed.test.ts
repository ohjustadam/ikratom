import { describe, expect, it } from "vitest";
import { DELETED_THREAD_BODY } from "@/lib/forum-permissions";
import { isStaleBill, memberFeedItems } from "@/modules/forum/member-feed";

const names = new Map([["a", "@ann"], ["b", "@ben"]]);
const parents = new Map([["t1", { title: "Oklahoma bill updates", state: "OK" }]]);
const thread = (over = {}) => ({
  id: "t2",
  state: "LA",
  title: "Roll call Louisiana",
  author_id: "a",
  created_at: "2026-11-05T10:00:00Z",
  ...over,
});

describe("memberFeedItems", () => {
  it("lists a member's thread with their handle", () => {
    const [item] = memberFeedItems({ threads: [thread()], posts: [], parents, names, limit: 5 });
    expect(item).toMatchObject({ kind: "thread", place: "LA", author: "@ann", href: "/forum/LA/t2" });
  });

  it("leaves the bot out, even a thread with no author", () => {
    const items = memberFeedItems({
      threads: [thread({ system_generated: true }), thread({ id: "t3", author_id: null })],
      posts: [{ thread_id: "t1", author_id: null, created_at: "2026-11-05T11:00:00Z" }],
      parents,
      names,
      limit: 5,
    });
    expect(items).toEqual([]);
  });

  it("leaves out a thread its author deleted", () => {
    const items = memberFeedItems({
      threads: [thread({ body: DELETED_THREAD_BODY })],
      posts: [],
      parents,
      names,
      limit: 5,
    });
    expect(items).toEqual([]);
  });

  it("shows a member's reply in the bot's thread, because a person wrote it", () => {
    const [item] = memberFeedItems({
      threads: [],
      posts: [{ thread_id: "t1", author_id: "b", created_at: "2026-11-05T11:00:00Z" }],
      parents,
      names,
      limit: 5,
    });
    expect(item).toMatchObject({ kind: "reply", title: "Oklahoma bill updates", author: "@ben" });
  });

  it("drops a reply whose thread can't be seen", () => {
    const items = memberFeedItems({
      threads: [],
      posts: [{ thread_id: "gone", author_id: "b", created_at: "2026-11-05T11:00:00Z" }],
      parents,
      names,
      limit: 5,
    });
    expect(items).toEqual([]);
  });

  it("puts the newest first and stops at the limit", () => {
    const items = memberFeedItems({
      threads: [thread(), thread({ id: "t4", created_at: "2026-11-06T10:00:00Z" })],
      posts: [],
      parents,
      names,
      limit: 1,
    });
    expect(items.map((i) => i.href)).toEqual(["/forum/LA/t4"]);
  });
});

describe("isStaleBill", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");

  it("flags a bill quiet for six months and no sooner", () => {
    expect(isStaleBill("2026-03-06", now)).toBe(true);
    expect(isStaleBill("2026-10-01", now)).toBe(false);
  });

  it("makes no claim when we don't know the date", () => {
    expect(isStaleBill(null, now)).toBe(false);
  });
});
