import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Coalition discussion board (2026-10-21). A member created a group and found
 * nothing to do on its page: "Shouldn't there be a discussion page where I can
 * coordinate with other members?" These pin the parts that must never regress:
 * members-only visibility, no cross-group writes, and @username-only authors.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0273_coalition_discussions.sql");
const actions = read("src/modules/coalitions/discussion-actions.ts");
const board = read("src/app/coalitions/[slug]/Discussion.tsx");
const thread = read("src/app/coalitions/[slug]/t/[threadId]/page.tsx");
const page = read("src/app/coalitions/[slug]/page.tsx");

describe("database rules", () => {
  it("both tables are behind RLS", () => {
    expect(sql).toMatch(/alter table public\.coalition_threads enable row level security/);
    expect(sql).toMatch(/alter table public\.coalition_posts enable row level security/);
  });

  it("only members (or site admins) can read", () => {
    const reads = sql.match(/for select to authenticated\s+using \(([^;]+)\);/g) ?? [];
    expect(reads).toHaveLength(2);
    for (const r of reads) expect(r).toMatch(/is_coalition_member\(coalition_id\) or public\.is_admin\(auth\.uid\(\)\)/);
    expect(sql).not.toMatch(/to anon|to public/);
  });

  it("you post as yourself, and a reply must land in a live thread of the SAME group", () => {
    expect(sql).toMatch(/with check \(author_id = auth\.uid\(\) and public\.is_coalition_member\(coalition_id\)\)/);
    expect(sql).toMatch(/t\.id = thread_id and t\.coalition_id = coalition_posts\.coalition_id and t\.deleted_at is null/);
  });
});

describe("server actions", () => {
  it("write through the user's client, so RLS proves membership", () => {
    expect(actions).toMatch(/ctx\.supabase\s*\.from\("coalition_threads"\)\s*\.insert/);
    expect(actions).toMatch(/ctx\.supabase\s*\.from\("coalition_posts"\)\s*\.insert/);
    // The service role is used for notifications and nothing else.
    const uses = actions.split("createServiceRoleClient()").length - 1;
    expect(uses).toBe(1);
    expect(actions).toMatch(/const admin = createServiceRoleClient\(\);\s*await admin\.from\("notifications"\)/);
  });

  it("are rate-limited and length-capped", () => {
    expect(actions).toMatch(/checkRateLimit\(`coalition:thread:/);
    expect(actions).toMatch(/checkRateLimit\(`coalition:reply:/);
    expect(actions).toMatch(/MAX_TITLE = 140/);
    expect(actions).toMatch(/MAX_BODY = 5000/);
  });

  it("a removal that RLS refused is reported, not silently 'done'", () => {
    expect(actions).toMatch(/data\.length === 0\) return \{ ok: false/);
  });
});

describe("public anonymity", () => {
  it("authors render through publicHandle via get_public_profiles, never full_name", () => {
    for (const src of [board, thread]) {
      expect(src).toMatch(/get_public_profiles/);
      expect(src).toMatch(/publicHandle\(/);
      expect(src).not.toMatch(/full_name/);
    }
  });

  it("the board renders only for members", () => {
    expect(page).toMatch(/\{viewerRole && <Discussion coalitionId=\{c\.id\} slug=\{c\.slug\} \/>\}/);
  });
});
