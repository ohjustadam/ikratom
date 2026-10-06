/**
 * egress-by-job.mjs — which cron jobs spend the Supabase egress budget?
 *
 *   node --env-file=.env.local scripts/egress-by-job.mjs            # last 24h
 *   node --env-file=.env.local scripts/egress-by-job.mjs --hours 168
 *
 * Reads the per-run egress_bytes stamped by scripts/lib/egress-meter.mjs.
 * Read-only. "~/month" scales the window to 30 days; the free cap is 5 GB/month
 * for the WHOLE project (site visitors included), so compare against that.
 */
import { createClient } from "@supabase/supabase-js";
import { egressByJob, mb } from "./lib/egress-by-job.mjs";

const args = process.argv.slice(2);
const hours = Number(args.includes("--hours") ? args[args.indexOf("--hours") + 1] : 24) || 24;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const jobs = await egressByJob(sb, { hours });
const total = jobs.reduce((n, j) => n + j.bytes, 0);
console.log(`Metered cron egress, last ${hours}h: ${mb(total)} across ${jobs.length} jobs (~${mb((total / hours) * 720)}/month of the 5GB cap)\n`);
console.log("share   total      per run   ~/month   runs  job");
for (const j of jobs.slice(0, 25)) {
  console.log(`${(j.share * 100).toFixed(1).padStart(5)}%  ${mb(j.bytes).padStart(8)}  ${mb(j.perRun).padStart(9)}  ${mb(j.perMonth).padStart(8)}  ${String(j.runs).padStart(4)}  ${j.source}`);
}
if (!jobs.length) console.log("(nothing metered yet: runs are stamped once the workflows preload scripts/lib/egress-meter.mjs)");
