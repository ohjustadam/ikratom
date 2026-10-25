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
