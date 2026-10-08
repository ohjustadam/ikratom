/**
 * egress-by-job.mjs — rank cron jobs by the Supabase egress they cost, from the
 * per-run `egress_bytes` the meter stamps (scripts/lib/egress-meter.mjs, 0262).
 */

/** Sum metered egress per source over the last `hours`. Sorted heaviest first. */
export async function egressByJob(sb, { hours = 24 } = {}) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("scraper_runs").select("source, egress_bytes")
      .gte("started_at", since).not("egress_bytes", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return summarize(rows, hours);
}

export function summarize(rows, hours) {
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.source) ?? { source: r.source, runs: 0, bytes: 0 };
    s.runs++;
    s.bytes += Number(r.egress_bytes) || 0;
    by.set(r.source, s);
  }
  const total = [...by.values()].reduce((n, s) => n + s.bytes, 0);
  return [...by.values()]
    .map((s) => ({ ...s, perRun: s.bytes / s.runs, perMonth: (s.bytes / hours) * 24 * 30, share: total ? s.bytes / total : 0 }))
    .sort((a, b) => b.bytes - a.bytes);
}

export const mb = (b) => `${(b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 0)}MB`;

/** "news_intake 41MB, enrich 12MB, …" for the watchdog's one-line note. */
export function topLine(jobs, n = 3) {
  return jobs.slice(0, n).map((j) => `${j.source} ${mb(j.bytes)}`).join(", ");
}
