import { describe, it, expect } from "vitest";
import {
  billUpdateComment,
  billUpdateKey,
  billWatchList,
  forumKey,
  planBillPosts,
} from "../scripts/lib/forum-bill-updates.mjs";

const bill = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  state: "OK",
  bill_number: "SB 860",
  scope: "state",
  status: "in_committee",
  last_action: "Referred to Health",
  last_action_at: "2026-02-03T00:00:00Z",
  title: "Kratom products",
  kratom_relevance: "anti",
  forum_thread_id: null,
  forum_update_key: null,
  ...over,
});

describe("what the bill bot posts", () => {
  it("comments on a bill it has never announced", () => {
    expect(planBillPosts([bill()]).comment).toHaveLength(1);
  });

  it("comments when the status or the last action date moves", () => {
    const seen = billUpdateKey(bill());
    expect(planBillPosts([bill({ forum_update_key: seen })]).comment).toHaveLength(0);
    expect(planBillPosts([bill({ forum_update_key: seen, status: "passed_chamber" })]).comment).toHaveLength(1);
    expect(planBillPosts([bill({ forum_update_key: seen, last_action_at: "2026-03-01" })]).comment).toHaveLength(1);
  });

  it("doesn't re-announce a bill from its old per-bill thread", () => {
    const plan = planBillPosts([bill({ forum_thread_id: "old" })]);
    expect(plan.comment).toHaveLength(0);
    expect(plan.silent).toHaveLength(1);
  });

  it("says whether a comment is a new bill or an update", () => {
    expect(billUpdateComment(bill(), "https://x")).toContain("New bill: OK SB 860");
    expect(billUpdateComment(bill({ forum_update_key: "a|b" }), "https://x")).toContain("Update: OK SB 860");
  });

  it("writes a status the way a person would", () => {
    expect(billUpdateComment(bill(), "https://x")).toContain("**Status:** in committee");
  });

  it("files federal bills under one key", () => {
    expect(forumKey(bill({ scope: "federal", state: "US" }))).toBe("US");
    expect(forumKey(bill())).toBe("OK");
  });

  it("keeps the opening list to ten bills", () => {
    const many = Array.from({ length: 13 }, (_, i) => bill({ id: `b${i}` }));
    const list = billWatchList("Oklahoma", many, "https://x");
    expect(list.match(/\/bills\//g)).toHaveLength(10);
    expect(list).toContain("3 more");
  });
});
