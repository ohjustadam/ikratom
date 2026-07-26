#!/usr/bin/env node
/**
 * rescue.mjs — diagnose iKratom WITHOUT the site, and without Claude.
 *
 * The 2026-07-22 outage ran ~18 hours because the AI Editor-in-Chief lives
 * inside /admin — when the site is down, so is the tool for fixing it. This
 * runs entirely outside the app, against the platform APIs directly.
 *
 *   node --env-file=.env.local scripts/rescue.mjs --diagnose
 *   node --env-file=.env.local scripts/rescue.mjs --diagnose --json
 *
 * Read-only. It changes nothing. Safe to run at any time, including while
 * everything is on fire.
 *
 * Plan + roadmap (AI chat loop, GitHub Actions surface, gated write tools):
 * private/RESCUE_CONSOLE_PLAN.md
 */
import { runDiagnostics, verdict, siteUrl } from "./lib/rescue-tools.mjs";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");

// --diagnose is currently the only mode; accept a bare invocation too so a
// panicking human doesn't have to remember a flag.
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
iKratom rescue console

  --diagnose   Check site, Vercel, database, crons, CI  (default)
  --json       Machine-readable output
  --help       This

Runs against the platform APIs directly, so it works when the site is down.
Read-only: it will not change anything.
`);
  process.exit(0);
}

const ICON = { true: "OK  ", false: "FAIL", null: "SKIP" };

function line(label, probe) {
  const mark = ICON[String(probe.ok)];
  console.log(`  [${mark}] ${label.padEnd(12)} ${probe.detail}`);
}

const started = Date.now();
if (!JSON_OUT) {
  console.log("\n=== iKratom rescue · diagnose ===");
  console.log(`target: ${siteUrl()}\n`);
}

const d = await runDiagnostics();
const v = verdict(d);

if (JSON_OUT) {
  console.log(JSON.stringify({ verdict: v, probes: d }, null, 2));
  process.exit(v.headline.startsWith("SITE DOWN") ? 1 : 0);
}

line("site", d.site);
line("vercel", d.vercel);
line("database", d.database);
line("crons", d.crons);
line("ci", d.github);
line("deploys", d.deployments);

console.log(`\n--- ${v.headline} ---`);
for (const a of v.actions) console.log(`  • ${a}`);

if (d.crons.items?.length) {
  console.log("\noldest cron sources:");
  for (const c of d.crons.items.slice(0, 5)) {
    console.log(`  ${String(c.source).padEnd(32)} ${c.hours_ago ?? "?"}h ago  ${c.status ?? ""}`);
  }
}
if (d.deployments.items?.length) {
  console.log("\nrecent READY deployments (rollback candidates):");
  for (const x of d.deployments.items.slice(0, 3)) {
    console.log(`  ${x.created}  ${x.url}`);
  }
}

console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
// Non-zero exit when the site is down, so this can gate a workflow step.
process.exit(v.headline.startsWith("SITE DOWN") ? 1 : 0);
