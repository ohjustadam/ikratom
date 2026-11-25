/**
 * crawl-stage.test.ts — getCrawlStage() must fail CLOSED.
 *
 * The brake that lowers the crawl stage must never depend on the thing that is
 * failing. A missing env var, a database error, a missing column (migration
 * 0332 not applied) and a nonsense value all have to read as stage 0, the fully
 * blocked list; only a clean, valid row opens anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  result: { data: null, error: null } as { data: unknown; error: unknown },
  throws: false,
}));

vi.mock("../src/lib/supabase/anon", () => ({
  createAnonClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (hoisted.throws) throw new Error("network down");
            return hoisted.result;
          },
        }),
      }),
    }),
  }),
}));

import { getCrawlStage } from "../src/lib/crawl-stage";

beforeEach(() => {
  hoisted.throws = false;
  hoisted.result = { data: null, error: null };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

describe("getCrawlStage", () => {
  it("reads a valid stage from site_config", async () => {
    for (const stage of [0, 1, 2, 3]) {
      hoisted.result = { data: { crawl_stage: stage }, error: null };
      expect(await getCrawlStage()).toBe(stage);
    }
  });

  it("is 0 when the database errors (including a missing column)", async () => {
    hoisted.result = { data: null, error: { message: 'column "crawl_stage" does not exist' } };
    expect(await getCrawlStage()).toBe(0);
  });

  it("is 0 when the call throws", async () => {
    hoisted.throws = true;
    expect(await getCrawlStage()).toBe(0);
  });

  it("is 0 when there is no row, or the value is nonsense", async () => {
    for (const data of [null, {}, { crawl_stage: null }, { crawl_stage: 9 }, { crawl_stage: -1 }, { crawl_stage: "high" }]) {
      hoisted.result = { data, error: null };
      expect(await getCrawlStage()).toBe(0);
    }
  });

  it("is 0 without Supabase env, without calling the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    hoisted.result = { data: { crawl_stage: 3 }, error: null };
    expect(await getCrawlStage()).toBe(0);
  });
});
