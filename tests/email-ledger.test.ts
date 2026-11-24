import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { fetchAll, digestRef, lastSentByUser, deliveredKeys, digestSinceFor, byPriority } from "../scripts/lib/email-ledger.mjs";

/**
 * 2026-11-18 scale audit: the member email cron emailed nobody past the 1,000th
 * member (PostgREST row cap) and, after a run cut short by quota, re-sent the
 * same meeting alert to everyone who already had it.
 */
describe("fetchAll", () => {
  it("pages until a short page, and never stops at the 1,000-row cap", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ i }));
    const calls: Array<[number, number]> = [];
    const make = () => ({ range: async (a: number, b: number) => { calls.push([a, b]); return { data: rows.slice(a, b + 1), error: null }; } });
    const got = await fetchAll(make);
    expect(got).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("throws on an error instead of returning a short list", async () => {
    await expect(fetchAll(() => ({ range: async () => ({ data: null, error: { message: "boom" } }) }))).rejects.toThrow("boom");
  });
});

describe("ledger helpers", () => {
  it("digestRef is the Eastern date", () => {
    expect(digestRef(Date.parse("2026-11-18T03:00:00Z"))).toBe("2026-11-17"); // 10 pm Eastern
    expect(digestRef(Date.parse("2026-11-18T15:00:00Z"))).toBe("2026-11-18");
  });
  it("keeps each member's latest send and keys deliveries by ref and member", () => {
    const m = lastSentByUser([{ user_id: "a", sent_at: "2026-11-16T10:00:00Z" }, { user_id: "a", sent_at: "2026-11-17T10:00:00Z" }, { user_id: "b", sent_at: "2026-11-15T10:00:00Z" }]);
    expect(m.get("a")).toBe("2026-11-17T10:00:00Z");
    expect(deliveredKeys([{ ref: "m1", user_id: "a" }]).has("m1:a")).toBe(true);
  });
  it("a member skipped yesterday gets both days; one emailed yesterday only gets what is new; never before the floor", () => {
    const floor = "2026-11-15T10:00:00Z", global = "2026-11-16T10:00:00Z";
    expect(digestSinceFor(global, floor, undefined)).toBe(global);
    expect(digestSinceFor(global, floor, "2026-11-17T10:00:00Z")).toBe("2026-11-17T10:00:00Z");
    expect(digestSinceFor("2026-11-01T00:00:00Z", floor, undefined)).toBe(floor);
  });
  it("orders hearings first, then the members emailed longest ago (never-emailed first)", () => {
    const job = (id: string, subject: string) => ({ user: { id }, msg: { subject } });
    const last = new Map([["old", "2026-11-10T00:00:00Z"], ["new", "2026-11-17T00:00:00Z"]]);
    const q = [job("new", "Your daily brief"), job("old", "Your daily brief"), job("never", "Your daily brief"), job("new", "A hearing this week")];
    expect(q.sort(byPriority(last)).map((j) => `${j.user.id}:${/hearing/.test(j.msg.subject) ? "H" : "-"}`)).toEqual(["new:H", "never:-", "old:-", "new:-"]);
  });
});

describe("send-email-notifications uses the ledger", () => {
  const src = readFileSync("scripts/send-email-notifications.mjs", "utf8");
  it("pages every member list instead of a .limit() PostgREST ignores", () => {
    expect(src).not.toMatch(/\.limit\((50_000|20_000)\)/);
    expect(src).toMatch(/fetchAll\(\(\) => sb\.from\("profiles"\)/);
    expect(src).toMatch(/fetchAll\(\(\) => sb\.from\("notification_preferences"\)/);
  });
  it("records a delivery only after a successful send, and never for a test or dry run", () => {
    expect(src).toMatch(/if \(r\.ok\) \{ sent\+\+; await remember\(job\.user, job\.refs\); \}/);
    expect(src).toMatch(/if \(DRY \|\| ONLY \|\| !LEDGER_OK \|\| !refs\?\.length\) return;/);
  });
  it("meetings, digest and announcements all skip what a member already has", () => {
    expect(src).toMatch(/fresh\.filter\(\(m\) => !had\.has\(`\$\{m\.id\}:\$\{u\.id\}`\)\)/);
    expect(src).toMatch(/refs: \[\{ source: "digest", ref \}\]/);
    expect(src).toMatch(/refs: \[\{ source: "announce", ref: slug \}\]/);
  });
  it("migration 0326 creates the ledger, service role only", () => {
    const sql = readFileSync("supabase/migrations/0326_email_deliveries.sql", "utf8");
    expect(sql).toMatch(/primary key \(source, ref, user_id\)/);
    expect(sql).toMatch(/grant select, insert, update, delete on public\.email_deliveries to service_role/);
    expect(sql).toMatch(/revoke all on public\.email_deliveries from anon, authenticated/);
  });
});
