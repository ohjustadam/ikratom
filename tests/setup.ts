/**
 * Test bootstrap. Loads .env.local so tests can hit the real Supabase project
 * (we test against a live DB — RLS verification needs real Postgres).
 *
 * Tests use a separate "test_*" prefixed user to avoid polluting real data.
 * Cleanup runs in afterAll hooks per test file.
 */

import { config } from "node:process";
import { readFileSync } from "node:fs";

// Manually parse .env.local since vitest doesn't auto-load it
try {
  const env = readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env.local not present in CI — tests that need it will skip
}

// Sanity: tests that hit Supabase need these
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.warn("[test] NEXT_PUBLIC_SUPABASE_URL not set — DB tests will skip");
}
