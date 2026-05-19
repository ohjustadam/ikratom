import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the read-only-mode emergency brake.
 *
 * Setup is heavy because the helper depends on the Supabase server
 * client + admin context helpers. We mock both so the tests stay
 * fast + don't hit the DB. Behavior we want to lock:
 *
 *   1. When the flag is OFF → assertNotReadOnly returns null (proceed)
 *   2. When the flag is ON + viewer is non-admin → returns error string
 *   3. When the flag is ON + viewer is admin → returns null (admin bypass)
 *   4. When the flag is ON + viewer is owner → returns null (owner bypass)
 *   5. When the site_config read errors → fail-open (return null) so a
 *      transient DB hiccup doesn't brick mutations
 *   6. When the flag is ON with a reason → reason is in the error string
 */

// Module-level mock state — reset per test.
let mockSiteConfig: { read_only_mode: boolean; read_only_reason: string | null } | null = null;
let mockSiteConfigError = false;
let mockAdminCtx: { ok: boolean; isAdmin: boolean; isOwner: boolean } = {
  ok: false, isAdmin: false, isOwner: false,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            if (mockSiteConfigError) throw new Error("simulated DB error");
            return { data: mockSiteConfig };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/modules/admin/actions", () => ({
  getAdminContext: async () => mockAdminCtx,
}));

// Import AFTER mocks are set so the helper sees the mocked modules.
async function loadHelper() {
  vi.resetModules();
  return await import("../read-only-mode");
}

describe("read-only-mode", () => {
  beforeEach(() => {
    mockSiteConfig = null;
    mockSiteConfigError = false;
    mockAdminCtx = { ok: false, isAdmin: false, isOwner: false };
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns null when read_only_mode is false", async () => {
    mockSiteConfig = { read_only_mode: false, read_only_reason: null };
    const { assertNotReadOnly } = await loadHelper();
    expect(await assertNotReadOnly()).toBeNull();
  });

  it("returns null when site_config row is missing", async () => {
    mockSiteConfig = null;
    const { assertNotReadOnly } = await loadHelper();
    expect(await assertNotReadOnly()).toBeNull();
  });

  it("returns an error string when read_only_mode is true for non-admin", async () => {
    mockSiteConfig = { read_only_mode: true, read_only_reason: null };
    mockAdminCtx = { ok: false, isAdmin: false, isOwner: false };
    const { assertNotReadOnly } = await loadHelper();
    const result = await assertNotReadOnly();
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result).toMatch(/read-only/i);
  });

  it("includes the reason in the error string when provided", async () => {
    mockSiteConfig = { read_only_mode: true, read_only_reason: "Spam wave triage" };
    mockAdminCtx = { ok: false, isAdmin: false, isOwner: false };
    const { assertNotReadOnly } = await loadHelper();
    const result = await assertNotReadOnly();
    expect(result).toContain("Spam wave triage");
  });

  it("returns null when caller is admin even with read_only_mode on", async () => {
    mockSiteConfig = { read_only_mode: true, read_only_reason: null };
    mockAdminCtx = { ok: true, isAdmin: true, isOwner: false };
    const { assertNotReadOnly } = await loadHelper();
    expect(await assertNotReadOnly()).toBeNull();
  });

  it("returns null when caller is owner even with read_only_mode on", async () => {
    mockSiteConfig = { read_only_mode: true, read_only_reason: "Anything" };
    mockAdminCtx = { ok: true, isAdmin: false, isOwner: true };
    const { assertNotReadOnly } = await loadHelper();
    expect(await assertNotReadOnly()).toBeNull();
  });

  it("fails open (returns null) when site_config read errors", async () => {
    mockSiteConfigError = true;
    const { assertNotReadOnly } = await loadHelper();
    // Fail-open is the documented behavior — a transient DB issue
    // should not brick mutations across the platform.
    expect(await assertNotReadOnly()).toBeNull();
  });

  it("getReadOnlyState surfaces the structured state", async () => {
    mockSiteConfig = { read_only_mode: true, read_only_reason: "Test reason" };
    const { getReadOnlyState } = await loadHelper();
    const state = await getReadOnlyState();
    expect(state.read_only).toBe(true);
    if (state.read_only) {
      expect(state.reason).toBe("Test reason");
    }
  });

  it("getReadOnlyState returns {read_only: false} when flag is off", async () => {
    mockSiteConfig = { read_only_mode: false, read_only_reason: null };
    const { getReadOnlyState } = await loadHelper();
    const state = await getReadOnlyState();
    expect(state.read_only).toBe(false);
  });
});
