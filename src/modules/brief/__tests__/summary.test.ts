import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for getOrGenerateBriefSummary — the cached LLM-generated
 * daily brief paragraph that appears at the top of /brief.
 *
 * Behavior to lock in:
 *   1. Cache hit → returns cached row without calling the LLM
 *   2. Cache miss + quiet day (all signal counts 0) → static fallback,
 *      no LLM call, written to cache with provider='static'
 *   3. Cache miss + signals present → calls AI router, returns generated
 *      summary, writes to cache
 *   4. LLM returns empty/short text → returns null (don't poison cache)
 *   5. LLM throws → returns null (caller renders without paragraph)
 *   6. Missing env vars (NEXT_PUBLIC_SUPABASE_URL/SERVICE_KEY) → returns
 *      null, never touches Supabase
 *
 * Mocking strategy: stub @supabase/supabase-js and @/lib/ai so the
 * helper's full code path runs but no external calls happen.
 */

// Mock state controllable per-test
let mockCacheRow: { summary_md: string; provider: string | null } | null = null;
let mockAiResult: { text: string; provider: string } | null = null;
let mockAiThrow = false;
const upsertedRows: unknown[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mockCacheRow }),
          }),
        }),
      }),
      upsert: async (row: unknown) => {
        upsertedRows.push(row);
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/ai", () => ({
  complete: async () => {
    if (mockAiThrow) throw new Error("simulated provider failure");
    return mockAiResult ?? { text: "stub generated summary text exceeding 20 chars", provider: "ollama" };
  },
}));

async function loadHelper() {
  vi.resetModules();
  return await import("../summary");
}

function baseSignals(): {
  scope: string;
  state_label: string | null;
  alerts_critical: number;
  alerts_warn: number;
  recent_alert_titles: string[];
  bills_moved: number;
  recent_bill_lines: string[];
  active_ops: number;
  active_op_names: string[];
} {
  return {
    scope: "OK",
    state_label: "Oklahoma",
    alerts_critical: 0,
    alerts_warn: 0,
    recent_alert_titles: [],
    bills_moved: 0,
    recent_bill_lines: [],
    active_ops: 0,
    active_op_names: [],
  };
}

describe("getOrGenerateBriefSummary", () => {
  beforeEach(() => {
    mockCacheRow = null;
    mockAiResult = null;
    mockAiThrow = false;
    upsertedRows.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key";
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns null when env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(baseSignals());
    expect(result).toBeNull();
  });

  it("returns cached row without calling LLM when cache hit", async () => {
    mockCacheRow = { summary_md: "cached paragraph", provider: "ollama" };
    const signals = baseSignals();
    signals.alerts_critical = 5; // would otherwise trigger LLM
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(signals);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe("cached paragraph");
    expect(result?.cached).toBe(true);
    expect(upsertedRows.length).toBe(0); // no writes when cache hit
  });

  it("returns static quiet summary when signals are all zero", async () => {
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(baseSignals());
    expect(result).not.toBeNull();
    expect(result?.cached).toBe(false);
    expect(result?.provider).toBe("static");
    expect(result?.summary).toMatch(/[Qq]uiet/);
    // Quiet day still upserts so subsequent reads hit the cache
    expect(upsertedRows.length).toBe(1);
  });

  it("calls AI router when signals are present and cache misses", async () => {
    mockAiResult = { text: "Today in OK, HB 1234 moved out of committee. Two alerts.", provider: "groq" };
    const signals = baseSignals();
    signals.alerts_critical = 2;
    signals.bills_moved = 1;
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(signals);
    expect(result).not.toBeNull();
    expect(result?.cached).toBe(false);
    expect(result?.provider).toBe("groq");
    expect(result?.summary).toContain("HB 1234");
    expect(upsertedRows.length).toBe(1);
  });

  it("returns null when LLM returns empty/short text", async () => {
    mockAiResult = { text: "short", provider: "ollama" };
    const signals = baseSignals();
    signals.alerts_critical = 3;
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(signals);
    expect(result).toBeNull();
    // Don't poison the cache with a useless summary
    expect(upsertedRows.length).toBe(0);
  });

  it("returns null when LLM throws — never crashes the brief page", async () => {
    mockAiThrow = true;
    const signals = baseSignals();
    signals.alerts_critical = 3;
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(signals);
    expect(result).toBeNull();
    expect(upsertedRows.length).toBe(0);
  });

  it("upsert payload includes scope + brief_date + summary + signals_used + provider", async () => {
    mockAiResult = { text: "Valid generated summary text exceeding 20 chars.", provider: "ollama" };
    const signals = baseSignals();
    signals.alerts_critical = 1;
    const { getOrGenerateBriefSummary } = await loadHelper();
    await getOrGenerateBriefSummary(signals);
    const row = upsertedRows[0] as Record<string, unknown>;
    expect(row.scope).toBe("OK");
    expect(typeof row.brief_date).toBe("string");
    expect(row.summary_md).toBe("Valid generated summary text exceeding 20 chars.");
    expect(row.signals_used).toBeDefined();
    expect(row.provider).toBe("ollama");
  });

  it("falls back to static for quiet day even with state_label null", async () => {
    const signals = baseSignals();
    signals.scope = "national";
    signals.state_label = null;
    const { getOrGenerateBriefSummary } = await loadHelper();
    const result = await getOrGenerateBriefSummary(signals);
    expect(result?.summary).toMatch(/[Qq]uiet/);
    expect(result?.summary).toMatch(/national/);
  });
});
