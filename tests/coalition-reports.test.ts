import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Report buttons on group content (trunk decision 2026-10-24): the ONE
 * generic report system (B4b's content_reports + ReportButton), wired into
 * group threads, replies and events. Never on your own content.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const thread = read("src/app/coalitions/[slug]/t/[threadId]/page.tsx");
const event = read("src/app/coalitions/[slug]/events/[eventId]/page.tsx");
const sql = read("supabase/migrations/0273_coalition_discussions.sql") + read("supabase/migrations/0283_coalition_events.sql");

describe("group content can be reported", () => {
  it("uses the shared ReportButton, not a second report system", () => {
    for (const src of [thread, event]) {
      expect(src).toMatch(/import \{ ReportButton \} from "@\/modules\/reports\/components\/ReportButton"/);
      expect(src).not.toMatch(/forum\/components\/ReportButton/);
    }
  });

  it("covers threads, replies and events, and never your own", () => {
    expect(thread).toMatch(/thread\.author_id !== user\.id && <ReportButton targetType="group_thread" targetId=\{thread\.id\}/);
    expect(thread).toMatch(/p\.author_id !== user\.id && <ReportButton targetType="group_post" targetId=\{p\.id\}/);
    expect(event).toMatch(/ev\.created_by !== user\.id && \(/);
    expect(event).toMatch(/<ReportButton targetType="group_event" targetId=\{ev\.id\}/);
  });

  it("keeps the owner columns report_content() reads", () => {
    expect(sql).toMatch(/create table if not exists public\.coalition_threads[\s\S]*?author_id\s+uuid not null/);
    expect(sql).toMatch(/create table if not exists public\.coalition_posts[\s\S]*?author_id\s+uuid not null/);
    expect(sql).toMatch(/create table if not exists public\.coalition_events[\s\S]*?created_by\s+uuid/);
  });
});

describe("moderators can open a reported group item", () => {
  const go = read("src/app/coalitions/go/[kind]/[id]/route.ts");
  const mod = read("src/modules/coalitions/moderation.ts");

  it("the go-link redirects only members or site moderators, and 404s everyone else", () => {
    expect(go).toMatch(/if \(!user\) return notFound\(\)/);
    expect(go).toMatch(/if \(!member && !\(await isSiteModerator\(sb, user\.id\)\)\) return notFound\(\)/);
    expect(go.indexOf("isSiteModerator(")).toBeLessThan(go.indexOf('from("coalitions").select("slug")'));
    expect(go).toMatch(/"Cache-Control": "private, no-store"/);
  });

  it("reads a private group's row with the service role only after the moderator check", () => {
    const fn = mod.slice(mod.indexOf("export async function groupForViewer"));
    expect(fn.indexOf("isSiteModerator(sb, userId)")).toBeLessThan(fn.indexOf("createServiceRoleClient()"));
  });

  it("the moderator view is read-only: no reply box, RSVP or report buttons", () => {
    expect(thread).toMatch(/\{isMember && <div id="reply"/);
    expect(thread).toMatch(/isMember && thread\.author_id !== user\.id && <ReportButton/);
    expect(event).toMatch(/\{isMember && !ev\.cancelled_at && !past && <RsvpButtons/);
  });

  it("a reported reply lands on its post", async () => {
    const { groupReportHref } = await import("@/modules/coalitions/moderation");
    expect(groupReportHref("group_post", "abc")).toBe("/coalitions/go/post/abc");
    expect(go).toMatch(/t\/\$\{data\.thread_id\}#post-\$\{id\}/);
    expect(thread).toMatch(/id=\{`post-\$\{p\.id\}`\}/);
  });
});

describe("the reports queue links group items to the moderator view", () => {
  it("maps each group type to its go-link", async () => {
    const { targetHref } = await import("@/modules/reports/types");
    expect(targetHref("group_thread", "t1")).toBe("/coalitions/go/thread/t1");
    expect(targetHref("group_post", "p1")).toBe("/coalitions/go/post/p1");
    expect(targetHref("group_event", "e1")).toBe("/coalitions/go/event/e1");
  });
});
