#!/usr/bin/env node
/**
 * measure-build-egress.mjs — how much Supabase egress does ONE `next build`
 * actually cost?
 *
 * WHY (2026-09-11). Converting pages to prerendered moved their database reads
 * from per-request to per-BUILD. I asserted that this made builds a meaningful
 * egress cost and used it to explain a 140 MB day — but asserting is not
 * measuring, and a story that fits the numbers is not the same as the cause.
 * This settles it.
 *
 * METHOD. Read Supabase's raw NIC transmit counter, run the build, read it
 * again. The delta is everything the project transmitted during the build,
 * which includes a little ambient traffic (crons are currently gated, and the
 * site is low-traffic, so ambient is small — it is reported separately as a
 * control so the number is not taken on faith).
 *
 * The counter is cumulative since instance start and is the same source the
 * egress watchdog uses, so BILLABLE_RATIO applies to it the same way.
 *
 *   node --env-file=.env.local scripts/measure-build-egress.mjs
 *   node --env-file=.env.local scripts/measure-build-egress.mjs --control-only
 */
import { spawnSync } from "node:child_process";
import { BILLABLE_RATIO } from "./lib/egress-budget.mjs";

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const REF = process.env.SUPABASE_PROJECT_REF || (URL_ ? new URL(URL_).host.split(".")[0] : null);
if (!REF || !KEY) { console.error("Missing Supabase env"); process.exit(1); }
const CONTROL_ONLY = process.argv.includes("--control-only");

async function counterBytes() {
  const res = await fetch(`https://${REF}.supabase.co/customer/v1/privileged/metrics`, {
    headers: { Authorization: `Basic ${Buffer.from(`service_role:${KEY}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`metrics ${res.status}`);
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (line.startsWith("node_network_transmit_bytes_total") && line.includes('service_type="db"')) {
      const v = Number(line.trim().split(/\s+/).pop());
      if (Number.isFinite(v)) return v;
    }
  }
  throw new Error("transmit counter not found in metrics");
}

const mb = (b) => (b / 1e6).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CONTROL: ambient transmit over a quiet interval, so the build number can
// be reported net of whatever was happening anyway.
console.log("Control: measuring ambient egress over 60s with no build running…");
const c0 = await counterBytes();
await sleep(60_000);
const c1 = await counterBytes();
const ambientPerMin = c1 - c0;
console.log(`  ambient ≈ ${mb(ambientPerMin)} MB/min raw (${mb(ambientPerMin * BILLABLE_RATIO)} MB/min billable)\n`);

if (CONTROL_ONLY) process.exit(0);

console.log("Running `next build` (this is the thing being measured)…");
const t0 = Date.now();
const b0 = await counterBytes();
const proc = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env,
});
const b1 = await counterBytes();
const mins = (Date.now() - t0) / 60_000;

const okBuild = /Compiled successfully/.test(proc.stdout ?? "");
const rawDelta = b1 - b0;
const ambient = ambientPerMin * mins;
const attributable = Math.max(0, rawDelta - ambient);

console.log(`  build ${okBuild ? "succeeded" : "FAILED — treat the number with suspicion"} in ${mins.toFixed(1)} min\n`);
console.log(`  raw transmit during build : ${mb(rawDelta)} MB`);
console.log(`  minus ambient (${mins.toFixed(1)} min) : ${mb(ambient)} MB`);
console.log(`  ATTRIBUTABLE TO THE BUILD : ${mb(attributable)} MB raw`);
console.log(`                            : ${mb(attributable * BILLABLE_RATIO)} MB BILLABLE\n`);

const billable = (attributable * BILLABLE_RATIO) / 1e6;
if (billable < 2) {
  console.log("VERDICT: builds are NOT a meaningful egress cost. If a day spiked,");
  console.log("the cause is elsewhere — do not blame the build.");
} else {
  console.log(`VERDICT: a build costs ~${billable.toFixed(1)} MB billable. At that rate,`);
  console.log(`  10 builds/day = ${(billable * 10).toFixed(0)} MB/day, which is material against a`);
  console.log("  5 GB monthly cap. Deploy and rebuild deliberately.");
}
