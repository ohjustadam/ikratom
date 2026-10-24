import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { memberChecklist, organizerChecklist, winLines, type WinsRow } from "@/modules/coalitions/home";

/**
 * Group home (migration 0284, owner picks B15b + B15c 2026-10-24): the wins
 * feed (counts only, never names), the welcome checklist, and the pinned post.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0284_coalition_wins_welcome.sql");
const actions = read("src/modules/coalitions/home-actions.ts");
const wins = read("src/app/coalitions/[slug]/Wins.tsx");
const page = read("src/app/coalitions/[slug]/page.tsx");

const zero: WinsRow = {
  letters_7d: 0, letters_total: 0, officials_7d: 0, members_acted_7d: 0, members_total: 1,
  new_members_7d: 0, events_7d: 0, events_upcoming: 0, posts_7d: 0,
};

describe("wins", () => {
  it("are counts in plain sentences, and empty when nothing happened", () => {
    expect(winLines(zero)).toEqual([]);
    expect(winLines({ ...zero, letters_7d: 12, new_members_7d: 3, members_acted_7d: 1 }).map((l) => l.text)).toEqual([
      "12 letters sent this week", "1 member took action", "3 new members joined",
    ]);
  });

  it("the RPC returns counts only, to members or visitors of a public group, never anon", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.coalition_wins"));
    expect(fn).toMatch(/returns table \(\s*letters_7d integer/);
    expect(fn).not.toMatch(/username|full_name|email|user_id uuid/);
    expect(fn).toMatch(/public\.is_coalition_member\(p_coalition_id\) or public\.is_admin\(auth\.uid\(\)\)\s+or exists \(select 1 from public\.coalitions c where c\.id = p_coalition_id and c\.is_public\)/);
    expect(sql).toMatch(/revoke execute on function public\.coalition_wins\(uuid\) from public, anon/);
  });

  it("only count letters a member sent after joining", () => {
    expect(sql).toMatch(/join m on m\.user_id = ca\.user_id and ca\.sent_at >= m\.joined_at/);
  });

  it("the card never renders a handle or name", () => {
    expect(wins).not.toMatch(/publicHandle|get_public_profiles|full_name/);
  });
});

describe("welcome checklist", () => {
  it("is join → introduce → act → invite, with join already done", () => {
    const steps = memberChecklist({
      slug: "g", introduced: false, acted: true, shared: false, pinnedThreadId: null, actionHref: "/campaigns/x",
    });
    expect(steps.map((s) => s.key)).toEqual(["join", "intro", "act", "invite"]);
    expect(steps.map((s) => s.done)).toEqual([true, false, true, false]);
    expect(steps[1].href).toBe("/coalitions/g?intro=1#discussion");
  });

  it("sends the hello to the pinned welcome post when there is one", () => {
    const steps = memberChecklist({
      slug: "g", introduced: false, acted: false, shared: false, pinnedThreadId: "t1", actionHref: "/campaigns",
    });
    expect(steps[1].href).toBe("/coalitions/g/t/t1#reply");
  });

  it("gives organizers their own four steps", () => {
    const steps = organizerChecklist({ slug: "g", shared: true, hasPinned: false, hasAction: false, hasEvent: true });
    expect(steps.map((s) => [s.key, s.done])).toEqual([["invite", true], ["welcome", false], ["act", false], ["event", true]]);
  });

  it("writes only the member's own row, after proving membership, rate-limited", () => {
    const stamp = actions.slice(actions.indexOf("async function stampOwnRow"));
    expect(stamp.indexOf("ownMembership(")).toBeLessThan(stamp.indexOf("createServiceRoleClient()"));
    expect(stamp).toMatch(/\.eq\("user_id", me\.user\.id\)/);
    expect(stamp).toMatch(/checkRateLimit\(`coalition:home:/);
  });
});

describe("pinned post", () => {
  it("only organizers can pin, enforced in the database on insert and update", () => {
    expect(sql).toMatch(/before insert or update on public\.coalition_threads/);
    expect(sql).toMatch(/not \(public\.is_coalition_admin\(new\.coalition_id\) or public\.is_admin\(auth\.uid\(\)\)\)/);
    const pin = actions.slice(actions.indexOf("export async function pinThread"));
    expect(pin).toMatch(/me\.role !== "owner" && me\.role !== "admin"/);
  });

  it("the page wires the checklist's one-tap shortcuts", () => {
    expect(page).toMatch(/sp\.welcome === "1" && isOrganizer/);
    expect(page).toMatch(/sp\.intro === "1"/);
    expect(page).toMatch(/openForm=\{sp\.plan === "1"\}/);
  });
});
