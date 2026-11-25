import { createAnonClient } from "@/lib/supabase/anon";
import { normalizeStage } from "@/lib/crawl-policy";

/**
 * The live crawl stage, from `site_config.crawl_stage` (migration 0332).
 *
 * Read by robots.ts and sitemap.ts, which re-render hourly, so changing the
 * number takes effect within an hour with no deploy. One tiny row per hour.
 *
 * FAILS CLOSED: a missing env var, a database error, a missing column (the
 * migration not applied yet) or any odd value is stage 0, the old fully blocked
 * list. The brake must never depend on the thing that is failing.
 *
 * Uses the cookie-less anon client: the robots and sitemap responses are shared
 * by every viewer, and `site_config` has a public read policy.
 */
export async function getCrawlStage(): Promise<number> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return 0;
  try {
    const { data, error } = await createAnonClient()
      .from("site_config")
      .select("crawl_stage")
      .eq("id", true)
      .maybeSingle();
    if (error) return 0;
    return normalizeStage((data as { crawl_stage?: unknown } | null)?.crawl_stage);
  } catch {
    return 0;
  }
}
