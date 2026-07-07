import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for /admin/console safety rails. These lock the security-
 * sensitive parts of runSqlQuery: the blocklist, the mutation-needs-
 * owner-plus-ack rule, the multi-statement refusal.
 *
 * Strategy: mock the auth + Supabase layers and only test the
 * validation logic the action runs BEFORE invoking the DB.
 */

// Mockable state
let mockCtx: { ok: boolean; isOwner: boolean; isAdmin?: boolean; userId?: string; email?: string } = {
  ok: true, isOwner: true, isAdmin: true, userId: "owner-id", email: "owner@example.com",
};
let mockRpcResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const recordedActions: Array<{ action: string; details?: Record<string, unknown> }> = [];

vi.mock("@/modules/admin/actions", () => ({
  getAdminContext: async () => mockCtx,
}));

vi.mock("@/lib/audit", () => ({
  recordAdminAction: async (input: { action: string; details?: Record<string, unknown> }) => {
    recordedActions.push(input);
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (_fn: string, _args: unknown) => mockRpcResult,
  }),
}));

vi.mock("next/cache", () => ({
  updateTag: () => {},
  revalidatePath: () => {},
}));

async function loadActions() {
  vi.resetModules();
  return await import("../console-actions");
}

describe("runSqlQuery — safety rails", () => {
  beforeEach(() => {
    mockCtx = { ok: true, isOwner: true, isAdmin: true, userId: "owner-id", email: "owner@example.com" };
    mockRpcResult = { data: [{ ok: 1 }], error: null };
    recordedActions.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub";
  });

  it("rejects when caller is not admin", async () => {
    mockCtx = { ok: false } as typeof mockCtx;
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select 1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/admin/i);
  });

  it("accepts a simple SELECT for the owner", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select count(*) from bills" });
    expect(r.ok).toBe(true);
  });

  it("rejects a SELECT for a non-owner admin (console is owner-only)", async () => {
    mockCtx = { ok: true, isOwner: false, isAdmin: true, userId: "admin-id", email: "admin@example.com" };
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select count(*) from bills" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner/i);
  });

  it("blocks reading the auth schema (SELECT auth.users would leak emails + hashes)", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select id, email, encrypted_password from auth.users" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked/i);
  });

  it("rejects an empty query", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it("rejects multi-statement queries", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select 1; select 2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/multi-statement/i);
  });

  it("allows a single statement with a trailing semicolon", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select 1;" });
    expect(r.ok).toBe(true);
  });

  it("blocks DROP TABLE", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "DROP TABLE bills" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked/i);
  });

  it("blocks TRUNCATE", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "TRUNCATE TABLE bills" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked/i);
  });

  it("blocks DELETE from auth.users", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "DELETE FROM auth.users WHERE id = 'foo'" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked/i);
  });

  it("blocks GRANT statements", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "GRANT SELECT ON bills TO public" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked/i);
  });

  it("blocks CREATE ROLE statements", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "CREATE ROLE attacker" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked/i);
  });

  it("UPDATE without acknowledge is refused (even for owner)", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "UPDATE bills SET active = false WHERE id = 'foo'" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/acknowledge/i);
  });

  it("UPDATE with acknowledge IS allowed for owner", async () => {
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({
      query: "UPDATE bills SET active = false WHERE id = 'foo'",
      acknowledge: true,
    });
    expect(r.ok).toBe(true);
  });

  it("UPDATE refused for non-owner admin even with acknowledge", async () => {
    mockCtx = { ok: true, isOwner: false, isAdmin: true, userId: "admin-id", email: "admin@example.com" };
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({
      query: "UPDATE bills SET active = false WHERE id = 'foo'",
      acknowledge: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner/i);
  });

  it("INSERT, DELETE, MERGE all flow through the mutation gate", async () => {
    const { runSqlQuery } = await loadActions();
    for (const verb of ["INSERT INTO bills (id) VALUES ('x')", "DELETE FROM bills WHERE id = 'x'", "MERGE INTO bills"]) {
      const r = await runSqlQuery({ query: verb });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/acknowledge/i);
    }
  });

  it("rejects queries longer than 50,000 chars", async () => {
    const huge = "select '" + "x".repeat(50_100) + "'";
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: huge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too long/i);
  });

  it("audit-logs the action with mutation flag", async () => {
    const { runSqlQuery } = await loadActions();
    await runSqlQuery({ query: "select 1" });
    expect(recordedActions.length).toBe(1);
    expect(recordedActions[0].action).toBe("console.sql_read");
    recordedActions.length = 0;
    await runSqlQuery({ query: "UPDATE bills SET active = false WHERE id = 'foo'", acknowledge: true });
    expect(recordedActions.length).toBe(1);
    expect(recordedActions[0].action).toBe("console.sql_mutation");
  });

  it("audit-logs an error too (so failures don't disappear)", async () => {
    mockRpcResult = { data: null, error: { message: "syntax error at end of input" } };
    const { runSqlQuery } = await loadActions();
    const r = await runSqlQuery({ query: "select 1" });
    expect(r.ok).toBe(false);
    expect(recordedActions.length).toBe(1);
    expect(recordedActions[0].action).toBe("console.sql_error");
  });
});

describe("flushCacheTag — auth", () => {
  beforeEach(() => {
    mockCtx = { ok: true, isOwner: true, isAdmin: true, userId: "owner-id", email: "owner@example.com" };
    recordedActions.length = 0;
  });

  it("rejects unknown tags", async () => {
    const { flushCacheTag } = await loadActions();
    // @ts-expect-error — purposefully testing an invalid value
    const r = await flushCacheTag("nonexistent");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown tag/i);
  });

  it("accepts the editable-content tag", async () => {
    const { flushCacheTag } = await loadActions();
    const r = await flushCacheTag("editable-content");
    expect(r.ok).toBe(true);
  });

  it("rejects non-admin caller", async () => {
    mockCtx = { ok: false } as typeof mockCtx;
    const { flushCacheTag } = await loadActions();
    const r = await flushCacheTag("editable-content");
    expect(r.ok).toBe(false);
  });
});

describe("revalidateAdminPath — path validation", () => {
  beforeEach(() => {
    mockCtx = { ok: true, isOwner: true, isAdmin: true, userId: "owner-id", email: "owner@example.com" };
    recordedActions.length = 0;
  });

  it("accepts /support", async () => {
    const { revalidateAdminPath } = await loadActions();
    const r = await revalidateAdminPath("/support");
    expect(r.ok).toBe(true);
  });

  it("rejects arbitrary URLs", async () => {
    const { revalidateAdminPath } = await loadActions();
    const r = await revalidateAdminPath("https://evil.example.com/x");
    expect(r.ok).toBe(false);
  });

  it("rejects paths with shell metacharacters", async () => {
    const { revalidateAdminPath } = await loadActions();
    const r = await revalidateAdminPath("/foo;bar");
    expect(r.ok).toBe(false);
  });

  it("accepts dynamic-route shapes like /bills/[id]", async () => {
    const { revalidateAdminPath } = await loadActions();
    const r = await revalidateAdminPath("/bills/[id]");
    expect(r.ok).toBe(true);
  });
});
