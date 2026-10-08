/**
 * egress-calibrate.mjs — match our egress estimate to the Supabase dashboard.
 *
 *   node --env-file=.env.local scripts/egress-calibrate.mjs --dashboard 2.729
 *   node --env-file=.env.local scripts/egress-calibrate.mjs --dashboard 2.729 --write
 *
 * Read the number at supabase.com/dashboard -> your organization -> Usage ->
 * Egress ("Used in period", in GB). Without --write it only prints what the new
 * ratio would be. Keeps a 10% over-report margin so the estimate errs high.
 * Run it about once a month, ideally a week or more into the billing cycle
 * (early-cycle numbers are too small to calibrate against).
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getEgressStatus, BILLABLE_RATIO, CALIBRATION } from "./lib/egress-budget.mjs";

const args = process.argv.slice(2);
const dashboardGB = Number(args[args.indexOf("--dashboard") + 1]);
if (!args.includes("--dashboard") || !(dashboardGB > 0)) {
  console.error("Usage: --dashboard <GB used this cycle, from the Supabase usage page> [--write]");
  process.exit(2);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const status = await getEgressStatus(sb);
if (status.usedMb == null) { console.error("No watchdog readings this cycle yet; try again later."); process.exit(1); }

const estimateGB = status.usedMb / 1000;
const margin = CALIBRATION.overReportMargin ?? 1.1;
const ratio = Number((BILLABLE_RATIO * (dashboardGB / estimateGB) * margin).toFixed(4));
console.log(`dashboard ${dashboardGB} GB · our estimate ${estimateGB.toFixed(3)} GB at ratio ${BILLABLE_RATIO}`);
console.log(`new ratio ${ratio} (estimate becomes ~${(dashboardGB * margin).toFixed(3)} GB, ${Math.round(margin * 100 - 100)}% above the dashboard on purpose)`);
if (ratio < 0.15 || ratio > 0.9) { console.error("That ratio is implausible — check the dashboard number and the cycle dates."); process.exit(1); }

if (args.includes("--write")) {
  const file = new URL("./lib/egress-calibration.json", import.meta.url);
  const next = { ...CALIBRATION, measuredAt: new Date().toISOString(), dashboardGB, estimateGBBefore: Number(estimateGB.toFixed(3)), ratioBefore: BILLABLE_RATIO, ratio };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log("written to scripts/lib/egress-calibration.json — commit it so the GitHub jobs use it.");
}
