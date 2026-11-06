import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { listingPending } from "../src/modules/coalitions/listing";

/**
 * New public groups wait for a moderator (owner, 2026-11-05; migration 0313).
 * is_public keeps meaning "listed", so the hold lives in a trigger and nothing
 * that filters on is_public has to change.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0313_coalition_listing_review.sql");
const decide = read("src/modules/coalitions/listing-actions.ts");
const queue = read("src/app/admin/moderation/groups/page.tsx");
const hub = read("src/app/admin/moderation/page.tsx");
const growth = read("src/modules/coalitions/growth-actions.ts");
const create = read("src/modules/coalitions/actions.ts");

describe("listingPending", () => {
  const at = "2026-11-05T00:00:00Z";
  it("is true only for a private group that asked and wasn't approved", () => {
    expect(listingPending({ is_public: false, listing_requested_at: at, listing_approved_at: null })).toBe(true);
    expect(listingPending({ is_public: false, listing_requested_at: null, listing_approved_at: null })).toBe(false);
    expect(listingPending({ is_public: true, listing_requested_at: at, listing_approved_at: at })).toBe(false);
    expect(listingPending({ is_public: false, listing_requested_at: at, listing_approved_at: at })).toBe(false);
  });
});

describe("the database holds the line", () => {
  it("turns is_public back off for anything unapproved", () => {
    expect(sql).toMatch(/if new\.is_public and new\.listing_approved_at is null then\s+new\.is_public := false;/);
    expect(sql).toMatch(/before insert or update of is_public, listing_approved_at on public\.coalitions/);
  });

  it("stops a member approving their own group through the API", () => {
    expect(sql).toMatch(/if current_user in \('anon', 'authenticated'\) then\s+new\.listing_approved_at := case when tg_op = 'UPDATE' then old\.listing_approved_at end;/);
  });

  it("keeps the live public groups listed", () => {
    const backfill = sql.indexOf("update public.coalitions set listing_approved_at = now() where is_public");
    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(sql.indexOf("create trigger coalition_listing_guard"));
  });
});

describe("moderator decisions", () => {
  it("check the moderator before the service-role write", () => {
    const guard = decide.indexOf('getAdminContext({ require: "moderate_forum" })');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(decide.indexOf("createServiceRoleClient()"));
    expect(decide).toContain("recordAdminAction(");
  });

  it("can't decide a group twice", () => {
    expect(decide).toMatch(/\.not\("listing_requested_at", "is", null\)\.is\("listing_approved_at", null\)/);
    expect(decide).toMatch(/if \(!group\) return \{ ok: false, error: "Already decided\." \}/);
  });

  it("the queue page checks access itself, and shows @usernames only", () => {
    expect(queue).toContain('getAdminContext({ require: "moderate_forum" })');
    expect(queue).toContain("publicHandle(");
    expect(queue).not.toMatch(/full_name|email/);
  });

  it("the hub counts the queue", () => {
    expect(hub).toContain('href="/admin/moderation/groups"');
    expect(hub).toMatch(/total = counts\.campaigns \+ counts\.intel \+ \(waitingGroups \?\? 0\)/);
  });
});

describe("organizers", () => {
  it("moderators hear about a group only when it was actually held", () => {
    expect(growth).toMatch(/if \(isPublic && !data\.is_public\) await tellModeratorsGroupWaiting/);
    expect(create).toMatch(/if \(input\.is_public\) await tellModeratorsGroupWaiting/);
  });

  it("asking is rate-limited, after the wording screen", () => {
    const fn = growth.slice(growth.indexOf("export async function setGroupVisibility"));
    expect(fn.indexOf("groupTextIssue(")).toBeLessThan(fn.indexOf("coalition:listing:"));
  });

  it("going private withdraws a waiting request", () => {
    expect(growth).toContain("{ is_public: false, listing_requested_at: null }");
  });
});
