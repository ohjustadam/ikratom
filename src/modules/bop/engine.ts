/**
 * Server-side bridge to the BoP scraper engine. The engine lives in
 * `scripts/lib/bop-engine.mjs` (so it's also runnable as a one-off
 * Node script via `npm run scrape:bop`) — this file lets server code
 * (cron, admin actions) call it without duplicating logic.
 *
 * No runtime difference from the .mjs entrypoint, just a typed wrapper.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// .mjs has no .d.ts — type via dynamic require shape below.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - no types for .mjs module
import * as engine from "../../../scripts/lib/bop-engine.mjs";

export type BopRunResult = {
  source: string;
  state: string;
  status: "ok" | "no_findings" | "error";
  inserted?: number;
  error?: string;
};

type EngineFn = (input: {
  supabase: SupabaseClient;
  limit?: number;
  excludeAdapters?: string[];
  onlyAdapters?: string[] | null;
}) => Promise<BopRunResult[]>;

export async function runBopScrape(input: {
  supabase: SupabaseClient;
  limit?: number;
}): Promise<BopRunResult[]> {
  // 75 = headroom for all 51 sources + future adjacent-agency rows.
  // Vercel serverless can't launch Chromium, so we explicitly exclude
  // playwright_browser sources here. Those run on the GitHub Actions
  // browser cron instead (see .github/workflows/cron-daily.yml).
  const fn = (engine as unknown as { runBopEngine: EngineFn }).runBopEngine;
  return fn({
    supabase: input.supabase,
    limit: input.limit ?? 75,
    excludeAdapters: ["playwright_browser"],
  });
}
