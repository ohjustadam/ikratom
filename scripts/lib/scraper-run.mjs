/**
 * Tiny shared helper that wraps a script body with scraper_runs
 * logging. Inserts a "running" row before the body, updates with
 * outcome + counts after.
 *
 * Usage:
 *   import { runWithLogging } from "./lib/scraper-run.mjs";
 *   await runWithLogging({ source: "sync_news_rss", supabase }, async () => {
 *     // … script body, returns { rowsAdded, rowsUpdated, notes? }
 *   });
 *
 * If the body throws, the run row is updated to status='error' with
 * the error message; the throw is re-raised so the script still
 * exits non-zero (CI catches the failure even though the row is logged).
 */

export async function runWithLogging({ source, supabase }, body) {
  const startedAt = new Date().toISOString();
  let runId = null;
  try {
    const { data } = await supabase
      .from("scraper_runs")
      .insert({ source, started_at: startedAt, status: "running" })
      .select("id")
      .single();
    runId = data?.id;
  } catch {
    // best-effort — never block the actual work on logging failure
  }

  try {
    const result = (await body()) ?? {};
    const empty = (result.rowsAdded ?? 0) === 0 && (result.rowsUpdated ?? 0) === 0;
    const status = empty ? "empty" : "success";
    if (runId) {
      await supabase.from("scraper_runs").update({
        finished_at: new Date().toISOString(),
        status,
        rows_added: result.rowsAdded ?? null,
        rows_updated: result.rowsUpdated ?? null,
        notes: result.notes ?? null,
      }).eq("id", runId);
    }
    return result;
  } catch (e) {
    if (runId) {
      await supabase.from("scraper_runs").update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: String(e?.message ?? e).slice(0, 500),
      }).eq("id", runId);
    }
    throw e;
  }
}
