/**
 * Rate-limit RPC verification. The check_rate_limit Postgres function is
 * what protects /signup and /signin from spam — verify it actually enforces.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_DB = !!(URL && SERVICE);

describe.skipIf(!HAS_DB)("check_rate_limit RPC", () => {
  // Lazy-init the client. `describe.skipIf` skips the `it()` callbacks but
  // STILL executes the describe-body factory, so the previous top-level
  // createClient() crashed in environments without env vars (CI on a public
  // repo, where we deliberately don't expose DB secrets).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: SupabaseClient<any, "public", "public", any, any>;
  const key = `test-rl-${Date.now()}`;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    // Clean any prior state
    await admin.from("rate_limits").delete().eq("key", key);
  });

  it("allows the first request through", async () => {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_max: 3,
      p_window_seconds: 60,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("allows up to the limit", async () => {
    for (let i = 0; i < 2; i++) {
      const { data } = await admin.rpc("check_rate_limit", {
        p_key: key,
        p_max: 3,
        p_window_seconds: 60,
      });
      expect(data).toBe(true);
    }
  });

  it("blocks once the limit is exceeded", async () => {
    const { data } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_max: 3,
      p_window_seconds: 60,
    });
    expect(data).toBe(false);
  });

  it("rejects pathological inputs", async () => {
    const { data: tooBig } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_max: 999_999,
      p_window_seconds: 60,
    });
    expect(tooBig).toBe(false);

    const { data: tooLong } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_max: 3,
      p_window_seconds: 999_999,
    });
    expect(tooLong).toBe(false);
  });
});
