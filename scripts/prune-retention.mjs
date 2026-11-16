/**
 * Nightly retention for state_briefings and scraper_runs (B20 follow-up,
 * owner approved 2026-10-28). The rules live in SQL, in
 * public.prune_retention() (migration 0300):
 *   * state_briefings: keep the active row + the 3 newest inactive per state;
 *     never drop a hand-written addendum the active row doesn't also carry.
 *   * scraper_runs: keep 90 days, plus each source's newest row.
 * letter_screen_blocks keeps 90 days too (0314): it names a member, so it doesn't
 * stay longer than it takes to see a pattern.
 * At most --limit rows per table per night, so a backlog drains gradually.
 *
 * Usage:
 *   node --env-file=.env.local scripts/prune-retention.mjs --dry-run
 *   node --env-file=.env.local scripts/prune-retention.mjs [--limit 5000]
 */
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 5000;
if (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > 50000) {
  console.error("--limit must be an integer between 1 and 50000");
  process.exit(2);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const t0 = new Date();
const { data, error } = await sb.rpc("prune_retention", { p_apply: !DRY_RUN, p_limit: LIMIT });
const row = data?.[0] ?? { briefings: 0, scraper_runs: 0 };
const verb = DRY_RUN ? "would delete" : "deleted";
const blockCutoff = new Date(t0.getTime() - 90 * 86_400_000).toISOString();
const oldBlocks = DRY_RUN
  ? sb.from("letter_screen_blocks").select("id", { count: "exact", head: true }).lt("created_at", blockCutoff)
  : sb.from("letter_screen_blocks").delete({ count: "exact" }).lt("created_at", blockCutoff);
const { count: blocks, error: blocksError } = await oldBlocks;
if (blocksError) console.error(`✗ letter_screen_blocks: ${blocksError.message}`);
const summary = `${verb} ${row.briefings} old state briefings, ${row.scraper_runs} scraper_runs older than 90 days, ${blocks ?? 0} letter-block records`;
console.log(error ? `✗ prune_retention: ${error.message}` : `✓ ${summary}${DRY_RUN ? " (dry run)" : ""}`);

if (!DRY_RUN) {
  // A backlog at the per-night cap is not an error, but say so: it drains
  // next run, and a cap hit every night means the limit is too low.
  const capped = row.briefings >= LIMIT || row.scraper_runs >= LIMIT;
  try {
    await sb.from("scraper_runs").insert({
      source: "prune_retention",
      started_at: t0.toISOString(),
      finished_at: new Date().toISOString(),
      status: error ? "error" : capped ? "partial" : "success",
      rows_updated: error ? 0 : row.briefings + row.scraper_runs,
      error_message: error ? error.message.slice(0, 500) : null,
      notes: error ? null : `${summary}${capped ? ` (hit --limit ${LIMIT}; rest next run)` : ""}`,
    });
  } catch { /* best-effort */ }
}
// exitCode, not process.exit(): exiting while the client's sockets close
// trips a libuv assertion on Windows.
process.exitCode = error ? 1 : 0;
