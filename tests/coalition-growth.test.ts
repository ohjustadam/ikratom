import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Groups slice 1+2+3 (owner pick 2026-10-21): reusable group link + QR +
 * referral credit, public landing with join requests, and "this week's group
 * action" with aggregate progress. Pins the privacy and permission edges.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0274_coalition_growth.sql");
const actions = read("src/modules/coalitions/growth-actions.ts");
const server = read("src/app/coalitions/[slug]/GroupGrowth.tsx");
const page = read("src/app/coalitions/[slug]/page.tsx");
const join = read("src/app/coalitions/join/[code]/page.tsx");

describe("database rules", () => {
  it("join requests are RLS-protected and explicitly granted (Supabase stops default grants 2026-10-30)", () => {
    expect(sql).toMatch(/alter table public\.coalition_join_requests enable row level security/);
    expect(sql).toMatch(/grant select, insert on public\.coalition_join_requests to authenticated/);
    expect(sql).not.toMatch(/to anon/);
  });

  it("only a non-member can request, only a PUBLIC group, only as themselves", () => {
    expect(sql).toMatch(/user_id = auth\.uid\(\)\s+and status = 'pending'\s+and exists \(select 1 from public\.coalitions c where c\.id = coalition_id and c\.is_public\)\s+and not public\.is_coalition_member\(coalition_id\)/);
  });

  it("decisions go through the RPC, which checks the caller is a group admin", () => {
    expect(sql).not.toMatch(/create policy[^;]*coalition_join_requests[^;]*for update/i);
    expect(sql).toMatch(/if not \(public\.is_coalition_admin\(v_req\.coalition_id\) or public\.is_admin\(auth\.uid\(\)\)\) then\s+raise exception/);
  });

  it("progress is members-only and counts only", () => {
    expect(sql).toMatch(/returns table \(members_total integer, members_acted integer, letters_sent integer\)/);
    expect(sql).toMatch(/public\.is_coalition_member\(p_coalition_id\) or public\.is_admin\(auth\.uid\(\)\)/);
    expect(sql).toMatch(/revoke execute on function public\.coalition_action_progress\(uuid\) from public, anon/);
  });
});

describe("server actions", () => {
  it("re-check the caller's group role before any service-role write", () => {
    for (const fn of ["setGroupVisibility", "setGroupAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      const guard = body.indexOf("isGroupAdmin(role)");
      const write = body.indexOf("createServiceRoleClient()");
      expect(guard, fn).toBeGreaterThan(-1);
      expect(guard, fn).toBeLessThan(write);
    }
  });

  it("the group link is reusable and carries the sharer's referral code", () => {
    expect(actions).toMatch(/reusable: true/);
    expect(actions).toMatch(/\?via=\$\{encodeURIComponent\(me\.invite_code\)\}/);
  });

  it("join requests are rate-limited", () => {
    expect(actions).toMatch(/checkRateLimit\(`coalition:join-request:/);
  });
});

describe("pages", () => {
  it("a signed-out visitor keeps the sharer's referral code through sign-in", () => {
    expect(join).toMatch(/redirect\(`\/login\?redirect=\$\{encodeURIComponent\(`\/coalitions\/join\/\$\{code\}`\)\}\$\{ref\}`\)/);
  });

  it("requesters render as @username; progress never lists people", () => {
    expect(server).toMatch(/publicHandle\(p\)/);
    expect(server).not.toMatch(/full_name/);
  });

  it("only non-members of PUBLIC groups see Ask to join", () => {
    expect(page).toMatch(/\{user && !viewerRole && c\.is_public && <RequestToJoin coalitionId=\{c\.id\} \/>\}/);
  });
});
